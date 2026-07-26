const Order = require("../models/Order");
const Counter = require("../models/Counter"); // 👈 Counter model import karein
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

    // Hit standard Meta endpoint
    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: "order_rejection_alert", // Tumhara naya professional template
          language: { code: "en_US" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: customerName }, // {{1}}
                { type: "text", text: orderId }, // {{2}}
                { type: "text", text: restaurantName }, // {{3}} 👈 Naya dynamic variable attach ho gaya
                { type: "text", text: rejectReason || "High order volume" }, // {{4}}
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

// Helper to compile incremental algorithmic daily tokens (#RS-0001)
// 🚀 100% Safe Sequential Order ID Generator (Resets daily per restaurant and prevents duplicate key clashes)

const generateReadableOrderId = async (restaurantId) => {
  try {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dateStr = `${yy}${mm}${dd}`; // e.g., "260726"

    // ⚡ ATOMIC OPERATION: Agar counter nahi hai toh create karega, hai toh securely seq ko +1 kar dega
    const counter = await Counter.findOneAndUpdate(
      { restaurantId, date: dateStr },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setOnInsert: { seq: 1 } }
    );

    const sequenceNumber = String(counter.seq).padStart(3, "0");
    return `#${dateStr}-${sequenceNumber}`; // Output: #260726-001, #260726-002...
  } catch (error) {
    console.error("❌ Order ID Generation Error:", error.message);
    const randomFallback = Math.floor(1000 + Math.random() * 9000);
    return `#ORD-${randomFallback}`;
  }
};

// Utility update
const decodeTableToken = (token) => {
  try {
    const decoded = atob(token);
    if (!decoded.includes("-TABLE-")) return "N/A"; // Security check
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
      tax,
      total,
      deliveryAddress,
      tableToken, // 💡 Yahan token receive hoga
      mergeWithTable, // 💡 Customer ne dusri table select ki (merge-picker se)
    } = req.body;

    // Token se table number decode karein
    const decodedTable = decodeTableToken(tableToken);
    const cleanMergeTable =
      mergeWithTable && String(mergeWithTable).trim()
        ? String(mergeWithTable).trim()
        : null;

    // 🔑 Merge ho ya na ho — sabhi tables jo is order se "occupy" hongi
    const tablesInvolved = [decodedTable, cleanMergeTable].filter(
      (t) => t && t !== "N/A",
    );

    // ✅ Order CREATE karne se PEHLE check karein — ab primary table ke
    // saath-saath merge-target table aur kisi bhi existing order ki
    // mergedTables list ke against bhi check hota hai
    if (tablesInvolved.length) {
      const existingOrder = await Order.findOne({
        restaurantId,
        status: { $in: ["ACCEPTED", "PENDING"] },
        $or: [
          { tableNumber: { $in: tablesInvolved } },
          { mergedTables: { $in: tablesInvolved } },
        ],
      });

      if (existingOrder) {
        const clashedTable = tablesInvolved.includes(existingOrder.tableNumber)
          ? existingOrder.tableNumber
          : tablesInvolved.find((t) => (existingOrder.mergedTables || []).includes(t));

        return res.status(400).json({
          success: false,
          message: `Table ${clashedTable} is already occupied. Please bill it first.`,
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

    const uniqueOrderId = await generateReadableOrderId(restaurantId);

    const newOrder = await Order.create({
      restaurantId,
      orderId: uniqueOrderId,
      customerName,
      customerPhone,
      orderType,
      tableNumber: decodedTable || "N/A", // 💡 Decoded value use karein
      mergedTables: cleanMergeTable ? [cleanMergeTable] : [], // 💡 merge ki gayi table(s)
      deliveryAddress: deliveryAddress || "",
      items,
      subtotal: Number(subtotal),
      tax: Number(tax) || 0,
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

    // 💡 Added .populate() to safely pull restaurant details from MongoDB
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

    // Broadcast updated status directly to the customer tracker channel room
    const io = getIO();
    io.to(order._id.toString()).emit("ORDER_STATUS_UPDATED", {
      orderId: order.orderId,
      status: order.status,
      rejectReason: order.rejectReason,
    });

    // ⚡ CALLING THE NEW 4-VARIABLE HANDLER
    if (
      status &&
      (status.toUpperCase() === "REJECTED" ||
        status.toUpperCase() === "DECLINED")
    ) {
      console.log(
        `🎯 Professional Rejection pipeline active for order ${order.orderId}...`,
      );

      // 💡 Safely extracts the dynamic restaurant name from populated data
      const currentRestaurantName =
        order.restaurantId && order.restaurantId.name
          ? order.restaurantId.name
          : "Our Kitchen";

      sendOfficialWhatsAppNotification(
        order.customerPhone,
        order.customerName,
        order.orderId,
        currentRestaurantName, // Live dynamic name goes to {{3}}
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

// @desc    Get Tenant specific active/pending/completed dashboard items lists for TODAY ONLY
// @route   GET /api/v1/orders/live
exports.getLiveAdminOrders = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const liveOrders = await Order.find({
      restaurantId: req.user.restaurantId,
      createdAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
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

    // Broadcast to dashboard to update UI
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

    // Time calculations
    if (filter === "today") {
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === "week") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (filter === "month") {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (filter === "year") {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    // Database Query
    const bills = await Order.find({
      restaurantId: rId,
      status: "COMPLETED", // Match this with your status string
      createdAt: { $gte: startDate },
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};