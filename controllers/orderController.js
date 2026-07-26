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
    const dateStr = `${yy}${mm}${dd}`;

    const counter = await Counter.findOneAndUpdate(
      { restaurantId, date: dateStr },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setOnInsert: { seq: 1 } }
    );

    const sequenceNumber = String(counter.seq).padStart(3, "0");
    return `#${dateStr}-${sequenceNumber}`;
  } catch (error) {
    console.error("❌ Order ID Generation Error:", error.message);
    const randomFallback = Math.floor(1000 + Math.random() * 9000);
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
      tableNumber: decodedTable || "N/A",
      mergedTables: cleanMergeTable ? [cleanMergeTable] : [],
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
      return res.status(404).json({ success: false, message: "Order not found" });
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