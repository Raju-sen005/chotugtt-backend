const mongoose = require("mongoose");

const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true }, // Veg, Non-Veg, Starters, Drinks etc.
    description: { type: String, trim: true },
    image: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    isVeg: { type: Boolean, default: true }, // 🆕 Veg (true) / Non-Veg (false)
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Multi-tenant indexing for instant categorization when sorting/loading menu catalog
menuItemSchema.index({ restaurantId: 1, category: 1, isAvailable: 1 });

module.exports = mongoose.model("MenuItem", menuItemSchema);
