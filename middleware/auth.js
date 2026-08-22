const jwt = require("jsonwebtoken");
const User = require("../models/User");

// const protect = async (req, res, next) => {
//   let token = req.cookies.token;

//   if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
//     token = req.headers.authorization.split(' ')[1];
//   }

//   if (!token) {
//     return res.status(401).json({ success: false, message: 'Not authorized, token missing' });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = await User.findById(decoded.id).select('-password');

//     if (!req.user) {
//       return res.status(401).json({ success: false, message: 'User no longer exists' });
//     }

//     next();
//   } catch (error) {
//     return res.status(401).json({ success: false, message: 'Not authorized, invalid token' });
//   }
// };
const protect = async (req, res, next) => {
  // Yahan 'jwt' use karein
  let token = req.cookies.jwt;
  console.log("🍪 JWT PRESENT:", !!token);
  if (!token && req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Not authorized, token missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("🔐 JWT USER ID:", decoded.id);
    console.log("👤 DB USER:", req.user ? String(req.user._id) : "NOT FOUND");
    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "User no longer exists" });
    }

    next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, message: "Not authorized, invalid token" });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role (${req.user.role}) is not allowed to access this resource`,
      });
    }
    next();
  };
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Access Denied" });
    }
    next();
  };
};

module.exports = { protect, restrictTo, authorize };
