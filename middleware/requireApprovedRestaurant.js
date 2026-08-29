const Restaurant = require("../models/Restaurant");

/**
 * Restaurant approved hai tabhi aage badhne deta hai.
 * Isse sirf CREATE actions (menu item/combo add, AI extract) pe lagao —
 * read/update/delete existing data ko block karne ki zaroorat nahi.
 */
async function requireApprovedRestaurant(req, res, next) {
  try {
    const restaurantId =
      typeof req.user?.restaurantId === "object"
        ? req.user.restaurantId._id
        : req.user?.restaurantId;

    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: "Restaurant context is missing",
      });
    }

    const restaurant = await Restaurant.findById(restaurantId)
      .select("isApproved isActive")
      .lean();

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: "Restaurant not found",
      });
    }

    if (restaurant.isActive === false) {
      return res.status(403).json({
        success: false,
        code: "RESTAURANT_DISABLED",
        message: "Your restaurant account is disabled.",
      });
    }

    if (!restaurant.isApproved) {
      return res.status(403).json({
        success: false,
        code: "RESTAURANT_NOT_APPROVED",
        message:
          "Your restaurant is pending verification. Menu items can only be added after approval.",
      });
    }

    next();
  } catch (error) {
    console.error("requireApprovedRestaurant error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to verify restaurant approval status",
    });
  }
}

module.exports = requireApprovedRestaurant;