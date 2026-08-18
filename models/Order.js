const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    orderId: { type: String, required: true }, // Short readable order tracking code (e.g., #RA-102)
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, default: "" },
    orderType: {
      type: String,
      enum: ["DINE_IN", "TAKEAWAY", "DELIVERY"],
      required: true,
    },
    items: [
      {
        itemType: { type: String, enum: ["SINGLE", "COMBO"], required: true },
        itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true },
        discount: { type: Number, default: 0, min: 0 },
        status: {
          type: String,
          enum: ["ACTIVE", "REJECTED"],
          default: "ACTIVE",
        }, // 🆕 per-item cancel
        kotPrintedAt: {
          type: Date,
          default: null,
        },
      },
    ],
    subtotal: { type: Number, required: true, min: 0 },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    tax: { type: Number, required: true, default: 0 },
    taxRate: { type: Number, default: 0 }, // 🆕 tax/subtotal ratio at order time — recalc ke liye zaroori
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "COMPLETED", "REJECTED"],
      default: "PENDING",
    },
    // Add inside orderSchema
    tableNumber: { type: String, default: "N/A" },
    paymentMethod: {
      type: String,
      enum: ["CASH", "UPI", "DUE"],
      default: null,
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PAID", "DUE"],
      default: "UNPAID",
      index: true,
    },

    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    dueAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentCollectedAt: {
      type: Date,
      default: null,
    },
    mergedTables: { type: [String], default: [] }, // 🔑 customer-side table-merge feature — other table(s) billed together with this order
    rejectReason: { type: String, default: "" },
  },
  { timestamps: true },
);
// orderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 });
orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

// 🔑 CRITICAL FIX: Compound Unique Index scoped strictly per Restaurant
orderSchema.index({ restaurantId: 1, orderId: 1 }, { unique: true });

module.exports = mongoose.model("Order", orderSchema);
