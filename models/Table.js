const mongoose = require("mongoose");

// 🔑 Table ab custom naam (tableNumber) + section (AC / Non-AC / Rooftop etc.) rakhti hai
const tableSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    // Yeh ab pure numeric nahi rehta — owner "AC1", "T1", "VIP-3" jaisa kuch bhi de sakta hai
    tableNumber: {
      type: String,
      required: true,
      trim: true,
    },
    // Section ka naam directly table pe store — grouping/display ke liye
    section: {
      type: String,
      required: true,
      trim: true,
      default: "General",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Ek restaurant ke andar same tableNumber dobara na ban paye (chahe kisi bhi section mein ho)
tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });

module.exports = mongoose.model("Table", tableSchema);