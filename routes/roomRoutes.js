const express = require("express");
const router = express.Router();
const {
  getRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  createBooking,
  getBookings,
} = require("../controllers/roomController");
const { protect } = require("../middleware/auth"); // Path check kar lein

// All routes require authentication
router.use(protect);

// Room Management Endpoints
router.route("/").get(getRooms).post(createRoom);
router.route("/:roomId").put(updateRoom).delete(deleteRoom);

// Booking Management Endpoints
router.route("/bookings").get(getBookings).post(createBooking);

module.exports = router;