const Order = require("../models/Order");
const Counter = require("../models/Counter");
const {
  // getIO,
  emitToRestaurant,
  emitToOrder,
} = require("../services/socketService");
const axios = require("axios");
const mongoose = require("mongoose");

const generateReadableOrderId = async (restaurantId) => {
  try {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dateStr = `${yy}${mm}${dd}`; // e.g., "260730"

    // Atomic increment per restaurant per day
    const counter = await Counter.findOneAndUpdate(
      {
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        date: dateStr,
      },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setOnInsert: { seq: 1 } },
    );

    // 🔑 6-Digit Padding (e.g., #260730-000001)
    const sequenceNumber = String(counter.seq).padStart(6, "0");
    return `#${dateStr}-${sequenceNumber}`;
  } catch (error) {
    console.error("❌ Order ID Generation Error:", error.message);
    // Fallback with high entropy random digits to prevent crash/duplicates
    const randomFallback = Math.floor(100000 + Math.random() * 900000);
    return `#ORD-${randomFallback}`;
  }
};

const decodeTableToken = (token) => {
  try {
    const decoded = atob(token);
    if (!decoded.includes("-TABLE-")) return "N/A";
    return decoded.split("-TABLE-")[1];
  } catch (e) {
    return "N/A";
  }
};

// @desc    Guest customer placing checkout cart objects
// @route   POST /api/v1/orders/place
exports.placeOrder = async (req, res) => {
  try {
    const {
      restaurantId,
      customerName,
      customerPhone,
      orderType,
      items,
      subtotal,
      discount,
      tax,
      total,
      deliveryAddress,
      tableToken,
      mergeWithTable,
    } = req.body;
    // 🔴 IMPORTANT
    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        message: "Restaurant ID is required to place order",
      });
    }
    const decodedTable = decodeTableToken(tableToken);
    const cleanMergeTable =
      mergeWithTable && String(mergeWithTable).trim()
        ? String(mergeWithTable).trim()
        : null;

    const tablesInvolved = [decodedTable, cleanMergeTable].filter(
      (t) => t && t !== "N/A",
    );

    if (tablesInvolved.length) {
      // 1. Check karein ki kya is table par pehle se koi active/accepted/pending order hai
      const existingOrder = await Order.findOne({
        restaurantId,
        status: { $in: ["ACCEPTED", "PENDING"] },
        $or: [
          { tableNumber: { $in: tablesInvolved } },
          { mergedTables: { $in: tablesInvolved } },
        ],
      });

      if (existingOrder) {
        // 🚀 APPEND LOGIC: Naya order banane ki bajay items ko existing order mein push karein
        existingOrder.items.push(...items);
        existingOrder.subtotal =
          Number(existingOrder.subtotal) + Number(subtotal);
        existingOrder.discount =
          Number(existingOrder.discount || 0) + Number(discount || 0); // 🆕 FIX: discount bhi merge hona chahiye
        existingOrder.tax = Number(existingOrder.tax || 0) + Number(tax || 0);
        existingOrder.total = Number(existingOrder.total) + Number(total);

        // 🔑 FIX: taxRate ko combined (dono orders milakar) totals se dobara calculate karo
        // warna item-cancel karte waqt purana (sirf pehle order ka) taxRate use hoke total galat aayega
        const combinedTaxableAmount =
          existingOrder.subtotal - existingOrder.discount;
        existingOrder.taxRate =
          combinedTaxableAmount > 0
            ? existingOrder.tax / combinedTaxableAmount
            : 0;

        await existingOrder.save();

        // const io = getIO();
        // 1. UI update ke liye
        emitToRestaurant(
          existingOrder.restaurantId,
          "ORDER_STATUS_UPDATED",
          existingOrder,
        );
        // 2. 🔔 Sound alert ke liye alag se event emit karein
        emitToRestaurant(
          restaurantId,
          "PLAY_NOTIFICATION_SOUND",
          existingOrder,
        );

        return res.status(200).json({
          success: true,
          message: "Items added to your running order successfully!",
          order: existingOrder,
        });
      }
    }

    if (
      orderType === "DELIVERY" &&
      (!deliveryAddress || deliveryAddress.length < 5)
    ) {
      return res.status(400).json({
        success: false,
        message: "Delivery address is required for delivery orders",
      });
    }

    // 2. Agar table khali hai, tabhi naya unique order banega
    const uniqueOrderId = await generateReadableOrderId(restaurantId);

    // 🔑 FIX: taxRate ab discount ke baad ke taxable amount se calculate hoga
    // (cancelOrderItem bhi taxableAmount = subtotal - discount use karta hai — formula match hona chahiye)
    const taxableAmount = Number(subtotal) - (Number(discount) || 0);

    const newOrder = await Order.create({
      restaurantId,
      orderId: uniqueOrderId,
      customerName,
      customerPhone,
      orderType,
      tableNumber: decodedTable || "N/A",
      mergedTables: cleanMergeTable ? [cleanMergeTable] : [],
      deliveryAddress: deliveryAddress || "",
      items,
      subtotal: Number(subtotal),
      discount: Number(discount) || 0,
      tax: Number(tax) || 0,
      taxRate: taxableAmount > 0 ? (Number(tax) || 0) / taxableAmount : 0, // 🆕 FIX
      total: Number(total),
    });

    // const io = getIO();
    emitToRestaurant(restaurantId, "NEW_ORDER_RECEIVED", newOrder);

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: newOrder,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Owner placing counter order (Parcel or Append to Table)
// @route   POST /api/v1/orders/counter-place
exports.placeCounterOrder = async (req, res) => {
  try {
    // 🔑 restaurantId req.user se lein agar req.body mein na ho
    const restaurantId = req.user?.restaurantId;
    const {
      orderType,
      items,
      subtotal,
      discount,
      tax,
      total,
      targetTableNumber,
    } = req.body;

    if (!restaurantId) {
      return res
        .status(400)
        .json({ success: false, message: "Restaurant ID is required" });
    }

    // 1. Agar targetTableNumber diya hai (Dine-in counter item addition)
    if (orderType === "DINE_IN_COUNTER" && targetTableNumber) {
      const cleanTable = String(targetTableNumber).trim();

      const existingOrder = await Order.findOne({
        restaurantId,
        status: { $in: ["ACCEPTED", "PENDING"] },
        $or: [{ tableNumber: cleanTable }, { mergedTables: cleanTable }],
      });

      if (existingOrder) {
        // Map frontend items to match schema requirements if necessary
        const formattedItems = items.map((i) => ({
          itemId: i.menuItem || i.combo || i.itemId,
          itemType: i.catalogType === "COMBO" ? "COMBO" : "SINGLE",
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          itemModel: i.itemModel || "MenuItem",
          discount: Number(i.discount) || 0,
        }));

        existingOrder.items.push(...formattedItems);
        existingOrder.subtotal =
          Number(existingOrder.subtotal) + Number(subtotal);
        existingOrder.discount =
          Number(existingOrder.discount || 0) + Number(discount || 0);
        existingOrder.tax = Number(existingOrder.tax || 0) + Number(tax || 0);

        const combinedTaxable = existingOrder.subtotal - existingOrder.discount;
        existingOrder.taxRate =
          combinedTaxable > 0 ? existingOrder.tax / combinedTaxable : 0;
        existingOrder.total = Number(existingOrder.total) + Number(total);

        await existingOrder.save();

        // const io = getIO();
        emitToRestaurant(
          existingOrder.restaurantId,
          "ORDER_STATUS_UPDATED",
          existingOrder,
        );
        emitToRestaurant(
          restaurantId,
          "PLAY_NOTIFICATION_SOUND",
          existingOrder,
        );

        return res.status(200).json({
          success: true,
          message: `Items successfully added to Table ${cleanTable}!`,
          order: existingOrder,
        });
      } else {
        return res.status(404).json({
          success: false,
          message: `Table ${cleanTable} par koi active order nahi mila!`,
        });
      }
    }

    // 2. Format items for Parcel / New Counter Order
    const formattedItems = items.map((i) => ({
      itemId: i.menuItem || i.combo || i.itemId,
      itemType: i.catalogType === "COMBO" ? "COMBO" : "SINGLE",
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      itemModel: i.itemModel || "MenuItem",
      discount: Number(i.discount) || 0,
    }));

    const uniqueOrderId = await generateReadableOrderId(restaurantId);
    const taxableAmount = Number(subtotal) - (Number(discount) || 0);

    const newOrder = await Order.create({
      restaurantId,
      orderId: uniqueOrderId,
      customerName: "Counter Parcel",
      customerPhone: "",
      orderType: "TAKEAWAY", // 🔑 Schema-compatible enum value (change to match your Order schema's enum)
      tableNumber: "PARCEL",
      items: formattedItems,
      subtotal: Number(subtotal),
      discount: Number(discount) || 0,
      tax: Number(tax) || 0,
      taxRate: taxableAmount > 0 ? (Number(tax) || 0) / taxableAmount : 0,
      total: Number(total),
      status: "PENDING",
    });

    // const io = getIO();

    emitToRestaurant(restaurantId, "NEW_ORDER_RECEIVED", newOrder);

    res.status(201).json({
      success: true,
      message: "Parcel order generated successfully!",
      order: newOrder,
    });
  } catch (error) {
    console.error("Counter Order Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTableOrder = async (req, res) => {
  try {
    const { tableNumber } = req.params;

    const order = await Order.findOne({
      restaurantId: req.user.restaurantId,
      tableNumber,
      status: { $in: ["PENDING", "ACCEPTED"] },
    });

    if (!order) {
      return res.json({
        success: true,
        order: null,
      });
    }

    res.json({
      success: true,
      order,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc    Admin transitioning live status configurations
// @route   PATCH /api/v1/orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, rejectReason } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order records not found",
      });
    }

    // 🔴 Reject
    if (status === "REJECTED") {
      order.status = "REJECTED";

      if (rejectReason) {
        order.rejectReason = rejectReason;
      }

      await order.save();

      // const io = getIO();

      emitToRestaurant(order.restaurantId, "ORDER_STATUS_UPDATED", order);

      return res.status(200).json({
        success: true,
        message: "Order marked as REJECTED",
        data: order,
        kotItems: [],
      });
    }

    // 🟢 Accept
    if (status === "ACCEPTED") {
      order.status = "ACCEPTED";

      await order.save();

      // 🆕 First-time KOT items
      const kotItems = order.items.filter(
        (item) => item.status !== "REJECTED" && !item.kotPrintedAt,
      );

      // const io = getIO();

      emitToRestaurant(order.restaurantId, "ORDER_STATUS_UPDATED", order);

      return res.status(200).json({
        success: true,
        message: "Order accepted successfully",
        data: order,

        // 🧾 Frontend automatic KOT ke liye
        kotItems,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid order status",
    });
  } catch (error) {
    console.error("Update Order Status Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// 🧾 GET UNPRINTED KOT ITEMS
// ============================================================
// @route GET /api/v1/orders/:id/kot
exports.getKOTItems = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Active order not found",
      });
    }

    const kotItems = order.items.filter(
      (item) => item.status !== "REJECTED" && !item.kotPrintedAt,
    );

    if (kotItems.length === 0) {
      return res.status(200).json({
        success: true,
        hasNewItems: false,
        message: "No new items available for KOT",
        data: {
          order,
          items: [],
        },
      });
    }

    return res.status(200).json({
      success: true,
      hasNewItems: true,
      data: {
        order,
        items: kotItems,
      },
    });
  } catch (error) {
    console.error("Get KOT Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// 🧾 MARK KOT ITEMS AS PRINTED
// ============================================================
// @route PATCH /api/v1/orders/:id/kot/printed
exports.markKOTPrinted = async (req, res) => {
  try {
    const { itemIds = [] } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Active order not found",
      });
    }

    const ids = new Set(itemIds.map(String));
    const now = new Date();

    let printedCount = 0;

    order.items.forEach((item) => {
      if (
        ids.has(String(item._id)) &&
        item.status !== "REJECTED" &&
        !item.kotPrintedAt
      ) {
        item.kotPrintedAt = now;
        printedCount++;
      }
    });

    await order.save();

    res.status(200).json({
      success: true,
      message: `${printedCount} KOT item(s) marked as printed`,
      data: order,
    });
  } catch (error) {
    console.error("Mark KOT Printed Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get Tenant specific active/pending dashboard orders (Unbilled orders will persist across days until cleared)
// @route   GET /api/v1/orders/live
exports.getLiveAdminOrders = async (req, res) => {
  try {
    // 🔑 Date restriction hata di gayi hai taaki unbilled orders tab tak dikhein jab tak bill generate na ho
    const liveOrders = await Order.find({
      restaurantId: req.user.restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] }, // Sirf active/unbilled orders aayenge
    }).sort({ createdAt: -1 });

    res
      .status(200)
      .json({ success: true, count: liveOrders.length, data: liveOrders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Complete order, record payment and free table
// @route   PATCH /api/v1/orders/:id/complete
exports.completeOrder = async (req, res) => {
  try {
    const { paymentMethod } = req.body;

    const allowedPaymentMethods = ["CASH", "UPI", "DUE"];

    if (!paymentMethod || !allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Valid payment method is required: CASH, UPI or DUE",
      });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Prevent accidental duplicate completion/payment recording
    if (order.status === "COMPLETED") {
      return res.status(409).json({
        success: false,
        message: "This order has already been billed.",
        data: order,
      });
    }

    if (order.status !== "ACCEPTED") {
      return res.status(400).json({
        success: false,
        message: "Only accepted orders can be billed.",
      });
    }

    const totalAmount = Number(order.total || 0);

    if (totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Order total must be greater than zero.",
      });
    }

    // ==========================================
    // PAYMENT CALCULATION
    // ==========================================

    order.status = "COMPLETED";
    order.paymentMethod = paymentMethod;

    if (paymentMethod === "DUE") {
      order.paymentStatus = "DUE";
      order.paidAmount = 0;
      order.dueAmount = totalAmount;
      order.paymentCollectedAt = null;
    } else {
      order.paymentStatus = "PAID";
      order.paidAmount = totalAmount;
      order.dueAmount = 0;
      order.paymentCollectedAt = new Date();
    }

    await order.save();

    // ==========================================
    // REALTIME UPDATE
    // ==========================================

    // const io = getIO();

    emitToRestaurant(order.restaurantId, "ORDER_STATUS_UPDATED", order);

    // ==========================================
    // RESPONSE
    // ==========================================

    return res.status(200).json({
      success: true,
      message:
        paymentMethod === "DUE"
          ? "Bill generated and marked as due."
          : `Bill generated successfully via ${paymentMethod}.`,
      data: order,
      payment: {
        method: paymentMethod,
        status: order.paymentStatus,
        total: totalAmount,
        paidAmount: order.paidAmount,
        dueAmount: order.dueAmount,
      },
    });
  } catch (error) {
    console.error("Complete Order Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getBillingStats = async (req, res) => {
  try {
    const { filter = "today", paymentMethod = "ALL" } = req.query;

    const restaurantId = new mongoose.Types.ObjectId(req.user.restaurantId);

    let startDate = new Date();

    if (filter === "today") {
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === "week") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (filter === "month") {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (filter === "year") {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const query = {
      restaurantId,
      status: "COMPLETED",
      createdAt: {
        $gte: startDate,
      },
    };

    if (["CASH", "UPI", "DUE"].includes(paymentMethod)) {
      query.paymentMethod = paymentMethod;
    }

    const bills = await Order.find(query).sort({ createdAt: -1 }).lean();

    const summary = {
      cash: 0,
      upi: 0,
      due: 0,
      cashCount: 0,
      upiCount: 0,
      dueCount: 0,
      totalCollected: 0,
      totalDue: 0,
    };

    for (const bill of bills) {
      const total = Number(bill.total || 0);

      if (bill.paymentMethod === "CASH") {
        summary.cash += total;
        summary.cashCount += 1;
        summary.totalCollected += total;
      }

      if (bill.paymentMethod === "UPI") {
        summary.upi += total;
        summary.upiCount += 1;
        summary.totalCollected += total;
      }

      if (bill.paymentMethod === "DUE") {
        summary.due += Number(bill.dueAmount || total);
        summary.dueCount += 1;
        summary.totalDue += Number(bill.dueAmount || total);
      }
    }

    res.status(200).json({
      success: true,
      data: bills,
      summary,
    });
  } catch (err) {
    console.error("Billing Stats Error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc    Cancel a single item within an order (out of stock etc.) — recalculates totals
// @route   PATCH /api/v1/orders/:id/item/:itemId/cancel
exports.cancelOrderItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const order = await Order.findOne({
      _id: id,
      restaurantId: req.user.restaurantId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const item = order.items.id(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found in this order",
      });
    }

    if (item.status === "REJECTED") {
      return res.status(400).json({
        success: false,
        message: "Item already cancelled",
      });
    }

    // At least one active item rehna chahiye
    const activeItems = order.items.filter((i) => i.status !== "REJECTED");

    if (activeItems.length <= 1) {
      return res.status(400).json({
        success: false,
        message: "Can't cancel the only item. Reject the whole order instead.",
      });
    }

    // Cancel item
    // Cancel item
    item.status = "REJECTED";

    // Remaining active items
    const remainingItems = order.items.filter((i) => i.status !== "REJECTED");

    // 🔑 FIX: har item ka apna stored discount jodo, ratio-guess mat karo
    const newSubtotal = remainingItems.reduce(
      (sum, i) => sum + Number(i.price) * Number(i.quantity),
      0,
    );
    const newDiscount = remainingItems.reduce(
      (sum, i) => sum + Number(i.discount || 0),
      0,
    );

    const taxableAmount = Math.max(0, newSubtotal - newDiscount);
    const newTax = Number(
      (taxableAmount * Number(order.taxRate || 0)).toFixed(2),
    );
    const newTotal = Number((taxableAmount + newTax).toFixed(2));

    order.subtotal = newSubtotal;
    order.discount = newDiscount;
    order.tax = newTax;
    order.total = newTotal;

    await order.save();

    // const io = getIO();

    emitToRestaurant(order.restaurantId, "ORDER_STATUS_UPDATED", order);

    return res.status(200).json({
      success: true,
      message: "Item cancelled successfully.",
      data: order,
    });
  } catch (error) {
    console.error("Cancel Item Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get revenue for the period *immediately before* the current filter window
//          (used for profit/loss % comparison on the Payments page)
// @route   GET /api/v1/orders/billing/previous
exports.getPreviousBillingStats = async (req, res) => {
  try {
    const { filter } = req.query;
    const rId = new mongoose.Types.ObjectId(req.user.restaurantId);

    const now = new Date();
    let currentStart = new Date();

    if (filter === "today") {
      currentStart.setHours(0, 0, 0, 0);
    } else if (filter === "week") {
      currentStart.setDate(currentStart.getDate() - 7);
    } else if (filter === "month") {
      currentStart.setMonth(currentStart.getMonth() - 1);
    } else if (filter === "year") {
      currentStart.setFullYear(currentStart.getFullYear() - 1);
    } else {
      currentStart.setHours(0, 0, 0, 0);
    }

    // 🔑 Current period ki exact length nikalo, phir usi length ka
    // ek aur window turant currentStart se pehle le lo — that's "previous period"
    const windowLength = now.getTime() - currentStart.getTime();
    const previousEnd = currentStart;
    const previousStart = new Date(currentStart.getTime() - windowLength);

    const previousBills = await Order.find({
      restaurantId: rId,
      status: "COMPLETED",
      createdAt: { $gte: previousStart, $lt: previousEnd },
    });

    const total = previousBills.reduce(
      (sum, bill) => sum + (Number(bill.total) || 0),
      0,
    );

    res.status(200).json({
      success: true,
      total,
      count: previousBills.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Move a running order from one table to another (customer changed seats)
// @route   PATCH /api/v1/orders/:id/shift-table
exports.shiftTableOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { newTableNumber } = req.body;

    if (!newTableNumber || !String(newTableNumber).trim()) {
      return res.status(400).json({
        success: false,
        message: "New table number is required",
      });
    }

    const cleanNewTable = String(newTableNumber).trim();

    const order = await Order.findOne({
      _id: id,
      restaurantId: req.user.restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] }, // sirf live orders shift ho sakte hain
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Active order not found for this table",
      });
    }

    if (order.tableNumber === cleanNewTable) {
      return res.status(400).json({
        success: false,
        message: "Order is already on this table",
      });
    }

    // 🔑 Naye table pe pehle se koi active order na ho, warna clash ho jayega
    const conflictOrder = await Order.findOne({
      restaurantId: req.user.restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
      $or: [{ tableNumber: cleanNewTable }, { mergedTables: cleanNewTable }],
    });

    if (conflictOrder) {
      return res.status(400).json({
        success: false,
        message: `Table ${cleanNewTable} already has a running order. Choose a free table.`,
      });
    }

    const previousTable = order.tableNumber;
    order.tableNumber = cleanNewTable;

    await order.save();

    // const io = getIO();
    emitToRestaurant(order.restaurantId, "ORDER_STATUS_UPDATED", order);

    res.status(200).json({
      success: true,
      message: `Order shifted from Table ${previousTable} to Table ${cleanNewTable}`,
      data: order,
    });
  } catch (error) {
    console.error("Shift Table Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
