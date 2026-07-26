const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true }, // Format: "260726"
  seq: { type: Number, default: 0 },
});

// Compound unique index taaki har restaurant ke liye date-wise ek hi counter document ho
counterSchema.index({ restaurantId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Counter", counterSchema);