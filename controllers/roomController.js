const Room = require("../models/Room");
const RoomBooking = require("../models/RoomBooking");
const { emitToRestaurant } = require("../services/socketService");

/*
 * --------------------------------------------------
 * ROOM CRUD CONTROLLERS
 * --------------------------------------------------
 */

// Get all rooms for authenticated restaurant
exports.getRooms = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const rooms = await Room.find({ restaurantId }).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    console.error("❌ Get rooms error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Create a new room
exports.createRoom = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { roomNumber, roomType, pricePerNight, capacity, description } = req.body;

    if (!roomNumber || !pricePerNight) {
      return res.status(400).json({ success: false, message: "Room number and price are required" });
    }

    const existingRoom = await Room.findOne({ restaurantId, roomNumber });
    if (existingRoom) {
      return res.status(400).json({ success: false, message: "Room number already exists for this restaurant" });
    }

    const room = await Room.create({
      restaurantId,
      roomNumber,
      roomType,
      pricePerNight,
      capacity,
      description,
    });

    emitToRestaurant(restaurantId, "ROOMS_UPDATED", { action: "CREATE", data: room });

    res.status(201).json({
      success: true,
      message: "Room created successfully",
      data: room,
    });
  } catch (error) {
    console.error("❌ Create room error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Update room details
exports.updateRoom = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { roomId } = req.params;

    const room = await Room.findOneAndUpdate(
      { _id: roomId, restaurantId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    emitToRestaurant(restaurantId, "ROOMS_UPDATED", { action: "UPDATE", data: room });

    res.status(200).json({
      success: true,
      message: "Room updated successfully",
      data: room,
    });
  } catch (error) {
    console.error("❌ Update room error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Delete room
exports.deleteRoom = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { roomId } = req.params;

    const room = await Room.findOne({ _id: roomId, restaurantId });
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (room.status === "Booked" || room.status === "Occupied") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete room while it is currently occupied or booked.",
      });
    }

    await Room.findOneAndDelete({ _id: roomId, restaurantId });

    emitToRestaurant(restaurantId, "ROOMS_UPDATED", { action: "DELETE", roomId });

    res.status(200).json({
      success: true,
      message: "Room deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete room error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/*
 * --------------------------------------------------
 * ROOM BOOKING CONTROLLERS
 * --------------------------------------------------
 */

// Create booking form submission
exports.createBooking = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { roomId, customerName, mobileNumber, checkInDate, checkOutDate, guestCount, idProof, totalAmount } = req.body;

    if (!roomId || !customerName || !mobileNumber || !checkInDate || !checkOutDate || !idProof) {
      return res.status(400).json({ success: false, message: "All required booking fields must be provided" });
    }

    const room = await Room.findOne({ _id: roomId, restaurantId });
    if (!room) {
      return res.status(404).json({ success: false, message: "Target room not found" });
    }

    if (room.status !== "Available") {
      return res.status(400).json({ success: false, message: "Room is currently occupied or under maintenance" });
    }

    const booking = await RoomBooking.create({
      restaurantId,
      roomId,
      customerName,
      mobileNumber,
      checkInDate,
      checkOutDate,
      guestCount: guestCount || room.capacity,
      idProof,
      totalAmount: totalAmount || room.pricePerNight,
      bookedBy: req.user._id,
    });

    room.status = "Occupied";
    await room.save();

    emitToRestaurant(restaurantId, "ROOM_BOOKING_CREATED", { booking, room });

    res.status(201).json({
      success: true,
      message: "Room booked successfully",
      data: booking,
    });
  } catch (error) {
    console.error("❌ Create booking error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Get all bookings for restaurant
exports.getBookings = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const bookings = await RoomBooking.find({ restaurantId })
      .populate("roomId", "roomNumber roomType pricePerNight")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings,
    });
  } catch (error) {
    console.error("❌ Get bookings error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/*
 * --------------------------------------------------
 * NEW CONTROLLERS FOR FRONTEND FIX (explore.tsx)
 * --------------------------------------------------
 */

// Get current active booking for a specific room
exports.getCurrentBooking = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params; // roomId

    const room = await Room.findOne({ _id: id, restaurantId });
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    // Find active/latest booking for this room
    const booking = await RoomBooking.findOne({ 
      restaurantId, 
      roomId: id, 
      status: { $ne: "Completed" } 
    }).sort({ createdAt: -1 });

    if (!booking) {
      return res.status(404).json({ success: false, message: "No active booking found for this room" });
    }

    res.status(200).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    console.error("❌ Get current booking error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Checkout guest and free up the room
exports.checkoutRoom = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params; // roomId

    const room = await Room.findOne({ _id: id, restaurantId });
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    // Update active booking status to Completed
    const booking = await RoomBooking.findOneAndUpdate(
      { restaurantId, roomId: id, status: { $ne: "Completed" } },
      { status: "Completed", checkOutDate: new Date() },
      { new: true }
    );

    // Free up room status
    room.status = "Available";
    await room.save();

    emitToRestaurant(restaurantId, "ROOMS_UPDATED", { action: "CHECKOUT", data: room });

    res.status(200).json({
      success: true,
      message: "Checkout successful, room is now available",
      data: { room, booking },
    });
  } catch (error) {
    console.error("❌ Checkout room error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};