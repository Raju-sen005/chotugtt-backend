const express = require("express");
const router = express.Router();
const {
  placeOrder,
  updateOrderStatus,
  getLiveAdminOrders,
  completeOrder,
  getBillingStats,
  cancelOrderItem,
  getPreviousBillingStats,
} = require("../controllers/orderController");
const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");

// Public checkout route interface target
router.post("/place", placeOrder);

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

router.get(
  "/billing/previous", // 🆕
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getPreviousBillingStats,
);
module.exports = router;
