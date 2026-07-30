const express = require("express");
const router = express.Router();
const {
  getPublicFreeTables,
  getTableStatusForAdmin,
  getAdminTableList,
  addAdminTable,
  toggleTableStatus,
  removeAdminTable,
} = require("../controllers/Tablecontroller");
const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");

// Public — customer-facing merge picker (same pattern as orderRoutes' /place)
router.get("/public/:restaurantId", getPublicFreeTables);

// Admin — same auth chain as your other admin-isolated routes
router.get(
  "/status",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getTableStatusForAdmin,
);
router.get(
  "/admin",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getAdminTableList,
);
router.post(
  "/admin",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  addAdminTable,
);
router.patch(
  "/admin/:tableNumber/toggle",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  toggleTableStatus, // 👈 Route add karein
);
router.delete(
  "/admin/:tableNumber",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  removeAdminTable,
);

module.exports = router;

/*
 * server.js mein mount karo (baaki routes jaisa hi pattern, no /api/v1 prefix):
 *
 *   const tableRoutes = require('./routes/tableRoutes');
 *   app.use('/tables', tableRoutes);
 *
 * Isse StoreSettings.jsx aur PublicMenu.jsx dono ke existing
 * `${VITE_APP_API_BASE}/tables/...` calls bina kisi change ke match ho jaayenge.
 */