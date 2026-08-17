const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    logo: { type: String, default: "" },
    themeColor: { type: String, default: "#EF4444" }, // Default Tailwind Red-500
    phone: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true },
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
    },
    // 💳 New UPI & Payment Integration Fields
    upiId: { type: String, default: "" },
    upiQrCode: { type: String, default: "" },
    qrCodeUrl: { type: String, default: "" },
    subscriptionPlan: {
      type: String,
      enum: ["STARTER", "PRO", "ENTERPRISE"],
      default: "STARTER",
    },
    subscriptionStatus: {
      type: String,
      enum: ["ACTIVE", "PAST_DUE", "CANCELED"],
      default: "ACTIVE",
    },
    isActive: { type: Boolean, default: true },
    // restaurantSchema mein add karein
    isApproved: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Index for ultra-fast slug lookup when customers scan QR code
restaurantSchema.index({ slug: 1 });

module.exports = mongoose.model("Restaurant", restaurantSchema);
