const express = require("express");
const router = express.Router();
const {
  placeOrder,
  placeCounterOrder,
  updateOrderStatus,
  getLiveAdminOrders,
  completeOrder,
  getBillingStats,
  cancelOrderItem,
  getPreviousBillingStats,
  getKOTItems,
  markKOTPrinted,
  shiftTableOrder,
  getTableOrder,
} = require("../controllers/orderController");
const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");

// Public checkout route interface target
router.post("/place", placeOrder);
router.post("/counter-place", protect, placeCounterOrder);
router.get(
  "/billing/previous", // 🆕
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getPreviousBillingStats,
);
router.get(
  "/billing",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getBillingStats,
);

// Admin-isolated real-time state manipulation pipeline interfaces
router.get(
  "/live",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getLiveAdminOrders,
);

router.get(
  "/:id/kot",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getKOTItems
);

router.patch(
  "/:id/kot/printed",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  markKOTPrinted
);

router.patch(
  "/:id/status",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  updateOrderStatus,
);

// Naya route add karein
router.patch(
  "/:id/complete",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  completeOrder,
);

router.patch(
  "/:id/item/:itemId/cancel",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  cancelOrderItem,
);

router.patch(
  "/:id/shift-table",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  shiftTableOrder,
);
router.get(
  "/table/:tableNumber",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getTableOrder,
);
module.exports = router;
