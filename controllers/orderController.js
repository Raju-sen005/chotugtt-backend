const Order = require("../models/Order");
const Counter = require("../models/Counter");
const { getIO } = require("../services/socketService");
const axios = require("axios");
const mongoose = require("mongoose");

// 🚀 1. PROFESSIONAL DYNAMIC WHATSAPP HANDLER (4 VARIABLES)
const sendOfficialWhatsAppNotification = async (
  customerPhone,
  customerName,
  orderId,
  restaurantName,
  rejectReason,
) => {
  try {
    let formattedPhone = customerPhone.replace(/\D/g, "");
    if (!formattedPhone.startsWith("91")) {
      formattedPhone = `91${formattedPhone}`;
    }

    const WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN;
    const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      console.log("⚠️ Env configuration variables are missing.");
      return;
    }

    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: "order_rejection_alert",
          language: { code: "en_US" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: customerName },
                { type: "text", text: orderId },
                { type: "text", text: restaurantName },
                { type: "text", text: rejectReason || "High order volume" },
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (response.status === 200 || response.status === 201) {
      console.log(
        `🚀 Professional Notification successfully fired to: ${formattedPhone}`,
      );
    }
  } catch (error) {
    console.error(
      "❌ Meta API Core Pipeline Error:",
      error.response?.data || error.message,
    );
  }
};

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

        const io = getIO();
        // 1. UI update ke liye
        io.to(restaurantId.toString()).emit(
          "ORDER_STATUS_UPDATED",
          existingOrder,
        );
        // 2. 🔔 Sound alert ke liye alag se event emit karein
        io.to(restaurantId.toString()).emit(
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

    const io = getIO();
    io.to(restaurantId.toString()).emit("NEW_ORDER_RECEIVED", newOrder);

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: newOrder,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    }).populate("restaurantId");

    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order records not found" });

    order.status = status;
    if (status === "REJECTED" && rejectReason) {
      order.rejectReason = rejectReason;
    }

    await order.save();

    const io = getIO();
    io.to(order._id.toString()).emit("ORDER_STATUS_UPDATED", {
      orderId: order.orderId,
      status: order.status,
      rejectReason: order.rejectReason,
    });

    if (
      status &&
      (status.toUpperCase() === "REJECTED" ||
        status.toUpperCase() === "DECLINED")
    ) {
      const currentRestaurantName =
        order.restaurantId && order.restaurantId.name
          ? order.restaurantId.name
          : "Our Kitchen";

      sendOfficialWhatsAppNotification(
        order.customerPhone,
        order.customerName,
        order.orderId,
        currentRestaurantName,
        order.rejectReason || "High order volume",
      );
    }

    res.status(200).json({
      success: true,
      message: `Order marked as ${status}`,
      data: order,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

// @desc    Complete Order & Free the Table
// @route   PATCH /api/v1/orders/:id/complete
exports.completeOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "COMPLETED" },
      { new: true },
    );

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const io = getIO();
    io.to(order.restaurantId.toString()).emit("ORDER_STATUS_UPDATED", order);

    res.status(200).json({ success: true, message: "Table is now free!" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBillingStats = async (req, res) => {
  try {
    const { filter } = req.query;
    const rId = new mongoose.Types.ObjectId(req.user.restaurantId);

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

    const bills = await Order.find({
      restaurantId: rId,
      status: "COMPLETED",
      createdAt: { $gte: startDate },
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    item.status = "REJECTED";

    // Remaining active items
    const remainingItems = order.items.filter((i) => i.status !== "REJECTED");

    // New Subtotal
    const newSubtotal = remainingItems.reduce(
      (sum, i) => sum + Number(i.price) * Number(i.quantity),
      0,
    );

    // Previous discount ratio
    const previousSubtotal = Number(order.subtotal || 0);
    const previousDiscount = Number(order.discount || 0);

    const discountRate =
      previousSubtotal > 0 ? previousDiscount / previousSubtotal : 0;

    const newDiscount = Number((newSubtotal * discountRate).toFixed(2));

    // Tax after discount
    const taxableAmount = Math.max(0, newSubtotal - newDiscount);

    const newTax = Number(
      (taxableAmount * Number(order.taxRate || 0)).toFixed(2),
    );

    const newTotal = Number((taxableAmount + newTax).toFixed(2));

    // Update order
    order.subtotal = newSubtotal;
    order.discount = newDiscount;
    order.tax = newTax;
    order.total = newTotal;

    await order.save();

    const io = getIO();

    io.to(order.restaurantId.toString()).emit("ORDER_STATUS_UPDATED", order);

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
