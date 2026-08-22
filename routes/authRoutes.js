const express = require("express");
const router = express.Router();
const {
  registerTenant,
  login,
  captainLogin,
  renewSubscription,
  logout,
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const upload = require("../middleware/upload"); // Aapka multer config

router.post("/register", upload.single("logo"), registerTenant);
router.post("/login", login);
router.post("/captain-login", captainLogin);
router.post("/logout", logout);
router.post("/renew-subscription", renewSubscription); // Added route
// Profile routes sanity test
router.get("/me", protect, (req, res) => {
  res.status(200).json({ success: true, data: req.user });
});

module.exports = router;
