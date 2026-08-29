const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    roomNumber: {
      type: String,
      required: [true, "Room number is required"],
      trim: true,
    },
    roomType: {
      type: String,
      enum: ["Deluxe", "Super Deluxe", "Suite", "Standard", "Executive"],
      default: "Standard",
    },
    pricePerNight: {
      type: Number,
      required: [true, "Price per night is required"],
      min: 0,
    },
    capacity: {
      type: Number,
      required: [true, "Capacity is required"],
      min: 1,
      default: 2,
    },
    status: {
      type: String,
      enum: ["Available", "Occupied", "Maintenance"],
      default: "Available",
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Unique room number per restaurant validation index
roomSchema.index({ restaurantId: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model("Room", roomSchema);