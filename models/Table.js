const mongoose = require("mongoose");

const tableSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    tableNumber: { type: String, required: true, trim: true },
    // 🔑 Soft-delete flag — table remove karne pe hard-delete nahi karte,
    // taaki purane orders (jo is table ko reference karte hain) ka history intact rahe
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Ek restaurant ke andar same table number dobara na ban sake
tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });

module.exports = mongoose.model("Table", tableSchema);