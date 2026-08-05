const mongoose = require("mongoose");

// 🔑 Section = "AC", "Non-AC", "Rooftop", "Garden" etc.
// Isse empty section bhi ban sakti hai (bina table add kiye), aur order/rename manage ho sakta hai
const sectionSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0, // display order — future mein drag-drop reorder ke liye
    },
  },
  { timestamps: true },
);

sectionSchema.index({ restaurantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Section", sectionSchema);