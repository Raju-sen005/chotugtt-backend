const express = require("express");
const router = express.Router();
const {
  getRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  createBooking,
  getBookings,
  getCurrentBooking,
  checkoutRoom,
} = require("../controllers/roomController");
const { protect } = require("../middleware/auth"); // Path check kar lein

// All routes require authentication
router.use(protect);

// Room CRUD Routes
router.route("/").get(getRooms).post(createRoom);

router.route("/:roomId").put(updateRoom).delete(deleteRoom);

// Booking Routes
router.route("/bookings").get(getBookings).post(createBooking);

// Specific Room Action Routes (Frontend explore.tsx fixes)
router.get("/:id/current-booking", getCurrentBooking);
router.post("/:id/checkout", checkoutRoom);

module.exports = router;
