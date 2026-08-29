const mongoose = require("mongoose");

const roomBookingSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: [true, "Room reference is required"],
    },
    customerName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
    },
    mobileNumber: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
    },
    checkInDate: {
      type: Date,
      required: [true, "Check-in date is required"],
    },
    checkOutDate: {
      type: Date,
      required: [true, "Check-out date is required"],
    },
    guestCount: {
      type: Number,
      required: [true, "Guest count is required"],
      min: 1,
    },
    idProof: {
      proofType: {
        type: String,
        required: [true, "ID Proof type is required (e.g., Aadhaar, PAN)"],
        trim: true,
      },
      proofNumber: {
        type: String,
        required: [true, "ID Proof number is required"],
        trim: true,
      },
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: 0,
    },
    bookingStatus: {
      type: String,
      enum: ["Confirmed", "Checked-In", "Checked-Out", "Cancelled"],
      default: "Confirmed",
    },
    bookedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RoomBooking", roomBookingSchema);