const fs = require("fs");
const path = require("path");
const Restaurant = require("../models/Restaurant");
const cloudinary = require("../config/cloudinary");
const QRCode = require("qrcode"); // 📦 Import local QR generator

// @desc    Update profile configurations (Logo, Theme, Address)
// @route   PATCH /api/v1/restaurant/profile
// @desc    Update profile configurations (Logo, Theme, Address, UPI ID)
// @route   PATCH /api/v1/restaurant/profile

// @desc    Update profile configurations (Logo, Theme, Address, UPI ID)
// @route   PATCH /api/v1/restaurant/profile
exports.updateRestaurantProfile = async (req, res) => {
  try {
    const updates = {};

    if (req.body.name) updates.name = req.body.name;
    if (req.body.slug) updates.slug = req.body.slug;
    if (req.body.phone) updates.phone = req.body.phone;
    if (req.body.email) updates.email = req.body.email;
    if (req.body.themeColor) updates.themeColor = req.body.themeColor;

    // 💳 Secure Local UPI QR Code Generation
    if (req.body.upiId !== undefined) {
      const requestedUpiId = req.body.upiId.trim();

      // Empty UPI is allowed only when no UPI has been configured yet
      if (!requestedUpiId) {
        const currentRestaurant = await Restaurant.findById(
          req.user.restaurantId,
        ).select("upiId");

        if (currentRestaurant?.upiId) {
          return res.status(403).json({
            success: false,
            code: "UPI_LOCKED",
            message:
              "UPI ID is already configured and cannot be removed. Please contact platform admin.",
          });
        }

        updates.upiId = "";
        updates.upiQrCode = "";
      } else {
        // Validate UPI format
        const upiRegex = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

        if (!upiRegex.test(requestedUpiId)) {
          return res.status(400).json({
            success: false,
            code: "INVALID_UPI_ID",
            message:
              "Please enter a valid UPI ID, for example: restaurant@paytm",
          });
        }

        const currentRestaurant = await Restaurant.findById(
          req.user.restaurantId,
        ).select("upiId name");

        if (!currentRestaurant) {
          return res.status(404).json({
            success: false,
            message: "Restaurant not found",
          });
        }

        // Already configured → owner cannot change it
        if (currentRestaurant.upiId) {
          if (
            requestedUpiId.toLowerCase() !==
            currentRestaurant.upiId.toLowerCase()
          ) {
            return res.status(403).json({
              success: false,
              code: "UPI_LOCKED",
              message:
                "UPI ID is already configured and cannot be changed from the profile. Please contact platform admin.",
            });
          }

          // Same UPI → no change required
        } else {
          // First-time UPI setup
          updates.upiId = requestedUpiId;

          const restaurantName =
            req.body.name || currentRestaurant.name || "Restaurant";

          const upiString =
            `upi://pay?pa=${encodeURIComponent(requestedUpiId)}` +
            `&pn=${encodeURIComponent(restaurantName)}` +
            `&cu=INR`;

          try {
            updates.upiQrCode = await QRCode.toDataURL(upiString, {
              errorCorrectionLevel: "H",
              margin: 2,
              scale: 6,
              color: {
                dark: "#000000",
                light: "#FFFFFF",
              },
            });
          } catch (qrError) {
            console.error("QR Generation Error:", qrError);

            return res.status(500).json({
              success: false,
              message: "Failed to generate secure payment QR code",
            });
          }
        }
      }
    }

    // Handle nested address fields securely
    if (req.body.address) {
      updates.address = {};
      if (req.body.address.street !== undefined)
        updates.address.street = req.body.address.street;
      if (req.body.address.city !== undefined)
        updates.address.city = req.body.address.city;
      if (req.body.address.state !== undefined)
        updates.address.state = req.body.address.state;
      if (req.body.address.zip !== undefined)
        updates.address.zip = req.body.address.zip;
    } else {
      if (
        req.body["address[street]"] !== undefined ||
        req.body["address[city]"] !== undefined ||
        req.body["address[state]"] !== undefined ||
        req.body["address[zip]"] !== undefined
      ) {
        updates.address = {};
        if (req.body["address[street]"] !== undefined)
          updates.address.street = req.body["address[street]"];
        if (req.body["address[city]"] !== undefined)
          updates.address.city = req.body["address[city]"];
        if (req.body["address[state]"] !== undefined)
          updates.address.state = req.body["address[state]"];
        if (req.body["address[zip]"] !== undefined)
          updates.address.zip = req.body["address[zip]"];
      }
    }

    // Handle Logo File Upload (Local Storage via Multer)
    if (req.file) {
      const existingRestaurant = await Restaurant.findById(
        req.user.restaurantId,
      );
      if (
        existingRestaurant &&
        existingRestaurant.logo &&
        existingRestaurant.logo.startsWith("/uploads/")
      ) {
        const oldPath = path.join(
          __dirname,
          "../public",
          existingRestaurant.logo,
        );
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (err) {
            console.error(err);
          }
        }
      }
      updates.logo = `/uploads/${req.file.filename}`;
    }

    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!updatedRestaurant) {
      return res
        .status(404)
        .json({ success: false, message: "Restaurant not found" });
    }

    res.status(200).json({
      success: true,
      message: "Profile and secure local QR updated successfully",
      data: updatedRestaurant,
    });
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
