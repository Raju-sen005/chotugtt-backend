const Restaurant = require("../models/Restaurant");
const cloudinary = require("../config/cloudinary");

// @desc    Update profile configurations (Logo, Theme, Address)
// @route   PATCH /api/v1/restaurant/profile
exports.updateRestaurantProfile = async (req, res) => {
  try {
    const updates = { ...req.body };

    // Check if an image/logo is passed in raw buffer via multer
    if (req.file) {
      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const uploadResponse = await cloudinary.uploader.upload(base64Image, {
        folder: "restaurant_logos",
      });
      updates.logo = uploadResponse.secure_url;
    }

    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { $set: updates },
      { new: true, runValidators: true },
    );

    res.status(200).json({ success: true, data: updatedRestaurant });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Public landing entry point to pull metadata via clean sub-domain/slug URL
// @route   GET /api/v1/restaurant/public/:slug
exports.getPublicRestaurantDetails = async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({
      slug: req.params.slug.toLowerCase(),
      isActive: true,
    });
    if (!restaurant) {
      return res
        .status(404)
        .json({ success: false, message: "Restaurant not found or disabled" });
    }
    res.status(200).json({ success: true, data: restaurant });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current restaurant profile details for admin/owner
// @route   GET /api/v1/restaurant/profile
exports.getRestaurantProfile = async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId);
    if (!restaurant) {
      return res
        .status(404)
        .json({ success: false, message: "Restaurant not found" });
    }
    res.status(200).json({ success: true, data: restaurant });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
