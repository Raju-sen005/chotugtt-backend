const express = require("express");
const router = express.Router();
const {
  updateRestaurantProfile,
  getPublicRestaurantDetails,
  getRestaurantProfile,
} = require("../controllers/restaurantController");
const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");
const upload = require("../middleware/upload");

// Admin panel dynamic setups
router.get(
  "/profile",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  getRestaurantProfile,
); // 👈 Yeh add karein
router.patch(
  "/profile",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  upload.single("logo"),
  updateRestaurantProfile,
);

// Public interface endpoint (No Auth token verification layers required)
router.get("/public/:slug", getPublicRestaurantDetails);

module.exports = router;
