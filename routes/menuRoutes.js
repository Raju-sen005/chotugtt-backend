const express = require("express");
const router = express.Router();
const {
  createMenuItem,
  getAdminMenuItems,
  updateMenuItem,
  deleteMenuItem,
  createCombo,
  getPublicCatalog,
  getAdminCombos,
  updateCombo,
  deleteCombo,
  extractMenuFromImage,
  getCaptainMenu,
} = require("../controllers/menuController");
const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");
const requireApprovedRestaurant = require("../middleware/requireApprovedRestaurant"); // 🔑 naya import

// 🔑 Multer middleware import karein (Apne project ke path ke hisaab se adjust karein)
const upload = require("../middleware/upload"); // ya jahan bhi aapne multer configure kiya hai

// Admin CRUD management bindings
router.use("/admin", protect, authorize("OWNER", "MANAGER"), tenantContext);

router
  .route("/admin/items")
  .post(requireApprovedRestaurant, upload.single("image"), createMenuItem) // 🔑 Yahan upload.single('image') joda gaya hai
  .get(getAdminMenuItems);

router.get(
  "/captain",
  protect,
  authorize("STAFF"),
  tenantContext,
  getCaptainMenu,
);

router
  .route("/admin/items/:id")
  .patch(upload.single("image"), updateMenuItem) // 🔑 Yahan bhi upload middleware add kiya
  .delete(deleteMenuItem);

router.post(
  "/admin/combos",
  requireApprovedRestaurant,
  upload.single("image"),
  createCombo,
); // 🔑 Combo ke liye bhi
router.get("/admin/combos", getAdminCombos);

router.post(
  "/admin/menu/ai-extract",
  upload.single("image"),
  extractMenuFromImage,
);

router
  .route("/admin/combos/:id")
  .patch(upload.single("image"), updateCombo) // 🔑 Combo update ke liye bhi
  .delete(deleteCombo);

// Open Customer Catalog endpoints
router.get("/public/catalog/:restaurantId", getPublicCatalog);

module.exports = router;
