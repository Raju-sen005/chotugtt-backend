const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Restaurant = require("../models/Restaurant");

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

/*
|--------------------------------------------------------------------------
| Helper
|--------------------------------------------------------------------------
*/

const getTenantId = (req) => {
  return (
    req.tenantId ||
    req.restaurantId ||
    req.user?.restaurantId
  );
};

const sanitizeStaff = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/*
|--------------------------------------------------------------------------
| GET STAFF / CAPTAINS
|--------------------------------------------------------------------------
| GET /api/v1/staff
|--------------------------------------------------------------------------
*/

exports.getStaff = async (req, res) => {
  try {
    const restaurantId = getTenantId(req);

    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: "Restaurant context is missing",
      });
    }

    if (!isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant context",
      });
    }

    const staff = await User.find({
      restaurantId,
      role: "STAFF",
    })
      .select(
        "_id name email role isActive lastLoginAt createdAt updatedAt"
      )
      .sort({
        createdAt: -1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      count: staff.length,
      data: staff.map((item) => ({
        id: item._id,
        name: item.name,
        email: item.email,
        role: item.role,
        isActive: item.isActive,
        lastLoginAt: item.lastLoginAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    console.error("getStaff error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch staff",
    });
  }
};

/*
|--------------------------------------------------------------------------
| CREATE STAFF / CAPTAIN
|--------------------------------------------------------------------------
| POST /api/v1/staff
|--------------------------------------------------------------------------
*/

exports.createStaff = async (req, res) => {
  try {
    const restaurantId = getTenantId(req);

    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: "Restaurant context is missing",
      });
    }

    if (!isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant context",
      });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Staff name must be at least 2 characters",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Verify restaurant
    |--------------------------------------------------------------------------
    */

    const restaurant = await Restaurant.findById(
      restaurantId
    ).select("_id isActive");

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: "Restaurant not found",
      });
    }

    if (!restaurant.isActive) {
      return res.status(403).json({
        success: false,
        message: "Restaurant account is inactive",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Email uniqueness
    |--------------------------------------------------------------------------
    */

    const existingUser = await User.findOne({
      email: cleanEmail,
    }).select("_id restaurantId role");

    if (existingUser) {
      return res.status(409).json({
        success: false,
        code: "EMAIL_ALREADY_REGISTERED",
        message: "This email is already registered",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Create Staff
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    | restaurantId comes ONLY from authenticated tenant.
    | role is ALWAYS STAFF.
    |
    */

    const staff = await User.create({
      restaurantId,
      name: cleanName,
      email: cleanEmail,
      password,
      role: "STAFF",
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: "Captain created successfully",
      data: sanitizeStaff(staff),
    });
  } catch (error) {
    console.error("createStaff error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "EMAIL_ALREADY_REGISTERED",
        message: "This email is already registered",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create captain",
    });
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE STAFF
|--------------------------------------------------------------------------
| PATCH /api/v1/staff/:staffId
|--------------------------------------------------------------------------
*/

exports.updateStaff = async (req, res) => {
  try {
    const restaurantId = getTenantId(req);
    const { staffId } = req.params;

    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: "Restaurant context is missing",
      });
    }

    if (!isValidObjectId(staffId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid staff ID",
      });
    }

    const { name, email, password } = req.body;

    const staff = await User.findOne({
      _id: staffId,
      restaurantId,
      role: "STAFF",
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Captain not found",
      });
    }

    if (name !== undefined) {
      const cleanName = String(name).trim();

      if (cleanName.length < 2) {
        return res.status(400).json({
          success: false,
          message: "Name must be at least 2 characters",
        });
      }

      staff.name = cleanName;
    }

    if (email !== undefined) {
      const cleanEmail = String(email)
        .trim()
        .toLowerCase();

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email address",
        });
      }

      const emailOwner = await User.findOne({
        email: cleanEmail,
        _id: { $ne: staff._id },
      }).select("_id");

      if (emailOwner) {
        return res.status(409).json({
          success: false,
          message: "This email is already registered",
        });
      }

      staff.email = cleanEmail;
    }

    if (password !== undefined && password !== "") {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }

      staff.password = password;
    }

    await staff.save();

    return res.status(200).json({
      success: true,
      message: "Captain updated successfully",
      data: sanitizeStaff(staff),
    });
  } catch (error) {
    console.error("updateStaff error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update captain",
    });
  }
};

/*
|--------------------------------------------------------------------------
| TOGGLE STAFF STATUS
|--------------------------------------------------------------------------
| PATCH /api/v1/staff/:staffId/status
|--------------------------------------------------------------------------
*/

exports.toggleStaffStatus = async (req, res) => {
  try {
    const restaurantId = getTenantId(req);
    const { staffId } = req.params;

    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: "Restaurant context is missing",
      });
    }

    if (!isValidObjectId(staffId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid staff ID",
      });
    }

    const staff = await User.findOne({
      _id: staffId,
      restaurantId,
      role: "STAFF",
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Captain not found",
      });
    }

    staff.isActive = !staff.isActive;

    await staff.save();

    return res.status(200).json({
      success: true,
      message: staff.isActive
        ? "Captain activated successfully"
        : "Captain disabled successfully",
      data: sanitizeStaff(staff),
    });
  } catch (error) {
    console.error("toggleStaffStatus error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update captain status",
    });
  }
};

/*
|--------------------------------------------------------------------------
| DELETE STAFF
|--------------------------------------------------------------------------
| DELETE /api/v1/staff/:staffId
|--------------------------------------------------------------------------
*/

exports.deleteStaff = async (req, res) => {
  try {
    const restaurantId = getTenantId(req);
    const { staffId } = req.params;

    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: "Restaurant context is missing",
      });
    }

    if (!isValidObjectId(staffId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid staff ID",
      });
    }

    const staff = await User.findOneAndDelete({
      _id: staffId,
      restaurantId,
      role: "STAFF",
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Captain not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Captain deleted successfully",
    });
  } catch (error) {
    console.error("deleteStaff error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to delete captain",
    });
  }
};