const Restaurant = require("../models/Restaurant");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const cloudinary = require("../config/cloudinary"); // Cloudinary configuration import karein

const generateTokenAndSetCookie = (res, userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("jwt", token, {
    httpOnly: true,
    secure: true, // Render par HTTPS hota hai, isliye TRUE rakhein
    sameSite: "none", // Cross-domain (Frontend/Backend alag) ke liye 'none' hi chahiye
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return token;
};

// @desc    Register a new Restaurant (Tenant) & Owner
// @route   POST /api/v1/auth/register
// @desc    Register a new Restaurant (Tenant) & Owner
// @route   POST /api/v1/auth/register
exports.registerTenant = async (req, res) => {
  const { restaurantName, slug, name, email, password, phone } = req.body;
  console.log("REQ.FILE:", req.file); // Yeh check karne ke liye ki multer file utha raha hai ya nahi
  console.log("REQ.BODY:", req.body);
  try {
    // 1. Safe slug generation & validation
    const finalSlug =
      slug || restaurantName
        ? (slug || restaurantName)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .replace(/-+/g, "-")
        : "";

    if (!finalSlug) {
      return res.status(400).json({
        success: false,
        message: "Valid restaurant name or slug is required",
      });
    }

    // Check if slug is unique
    const slugExists = await Restaurant.findOne({ slug: finalSlug });
    if (slugExists)
      return res
        .status(400)
        .json({ success: false, message: "Slug/Custom URL already taken" });

    // Check if user email exists
    const userExists = await User.findOne({ email });
    if (userExists)
      return res
        .status(400)
        .json({ success: false, message: "Email already registered" });

    // Check if mobile number is already registered with another restaurant
    const phoneExists = await Restaurant.findOne({ phone });

    if (phoneExists) {
      return res.status(400).json({
        success: false,
        code: "PHONE_ALREADY_REGISTERED",
        message:
          "This mobile number is already registered with another restaurant.",
      });
    }

    let logoUrl = "";

    // 🖼️ Agar file aayi hai, toh local file ka path ya relative URL save karein
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "chotu/restaurants/logos",
            resource_type: "image",
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          },
        );

        uploadStream.end(req.file.buffer);
      });

      logoUrl = result.secure_url;
    }

    // 2. Create Restaurant Profile with Logo
    const restaurant = await Restaurant.create({
      name: restaurantName,
      slug: finalSlug,
      phone,
      email,
      logo: logoUrl, // Cloudinary URL or empty string
    });

    // 3. Create Owner Account linked to this Restaurant
    const user = await User.create({
      restaurantId: restaurant._id,
      name,
      email,
      password,
      role: "OWNER",
    });

    generateTokenAndSetCookie(res, user._id);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        restaurant,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Login User (Owner/Staff)
// @route   POST /api/v1/auth/login
// exports.login = async (req, res) => {
//   const { email, password } = req.body;

//   try {
//     if (!email || !password)
//       return res
//         .status(400)
//         .json({ success: false, message: "Please provide email and password" });

//     const user = await User.findOne({ email });
//     if (!user || !(await user.comparePassword(password))) {
//       return res
//         .status(401)
//         .json({ success: false, message: "Invalid credentials" });
//     }

//    // controllers/authController.js

// const restaurant = await Restaurant.findById(user.restaurantId);

// // Check: Agar user SUPERADMIN nahi hai, TABHI isActive check karein
// if (user.role !== 'SUPERADMIN' && !restaurant.isActive) {
//   return res.status(403).json({
//     success: false,
//     message: "Your restaurant account is currently inactive. Please contact support for assistance.",
//   });
// }

//     generateTokenAndSetCookie(res, user._id);

//     res.status(200).json({
//       success: true,
//       data: {
//         id: user._id,
//         name: user.name,
//         email: user.email,
//         role: user.role,
//         restaurantId: user.restaurantId,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// @desc    Login User (Owner/Staff)
// @route   POST /api/v1/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: "Please provide email and password" });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const restaurant = await Restaurant.findById(user.restaurantId);

    // Check: Agar user SUPERADMIN nahi hai, TABHI isActive check karein
    if (user.role !== "SUPERADMIN" && !restaurant.isActive) {
      return res.status(403).json({
        success: false,
        message:
          "Your restaurant account is currently inactive. Please contact support for assistance.",
      });
    }

    // --- NEW: SUBSCRIPTION & RENEWAL CHECK ---
    // Agar owner hai, toh check karo ki subscription active hai ya nahi
    if (user.role === "OWNER") {
      const isPastDue = restaurant.subscriptionStatus === "PAST_DUE";
      const isCanceled = restaurant.subscriptionStatus === "CANCELED";

      if (isPastDue || isCanceled) {
        return res.status(403).json({
          success: false,
          requiresSubscription: true, // Frontend isse catch karke payment page par bhejega
          restaurantId: restaurant._id,
          message:
            "Your subscription has expired or is past due. Please renew to access your dashboard.",
        });
      }
    }
    // ----------------------------------------

    generateTokenAndSetCookie(res, user._id);

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId,
        subscriptionStatus: restaurant.subscriptionStatus,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Activate or Renew Subscription after Payment
// @route   POST /api/v1/auth/renew-subscription
exports.renewSubscription = async (req, res) => {
  const { restaurantId, plan } = req.body;

  try {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res
        .status(404)
        .json({ success: false, message: "Restaurant not found" });
    }

    // Update subscription details
    restaurant.subscriptionStatus = "ACTIVE";
    if (plan) {
      restaurant.subscriptionPlan = plan; // e.g., 'PRO', 'ENTERPRISE'
    }
    await restaurant.save();

    res.status(200).json({
      success: true,
      message: "Subscription renewed successfully!",
      data: restaurant,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Logout User / Clear Cookie
// @route   POST /api/v1/auth/logout
exports.logout = async (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
    secure: true, // Same config as login
    sameSite: "none",
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
};
