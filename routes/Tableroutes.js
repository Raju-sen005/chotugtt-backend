const express = require("express");

const router = express.Router();

const {
  getPublicFreeTables,
  getTableStatusForAdmin,
  getAdminTableList,
  getPublicTableStatus,
  addAdminTable,
  toggleTableStatus,
  removeAdminTable,
  regenerateAllTableTokens,
  moveTableSection,
} = require("../controllers/Tablecontroller");

const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");

const TABLE_ADMIN_ROLES = ["OWNER", "MANAGER", "STAFF"];
const TABLE_WRITE_ROLES = ["OWNER", "MANAGER"];

/*
|--------------------------------------------------------------------------
| PUBLIC
|--------------------------------------------------------------------------
| These endpoints intentionally use restaurantId from URL because
| customer/public menu does not have authenticated restaurant context.
|
| IMPORTANT:
| restaurantId is ONLY used to select the requested public tenant.
| No authenticated tenant data is trusted from client.
|--------------------------------------------------------------------------
*/

router.get(
  "/public/:restaurantId",
  getPublicFreeTables
);

router.post(
  "/admin/regenerate-tokens",
  protect,
  authorize("OWNER"),
  tenantContext,
  regenerateAllTableTokens
);

router.get(
  "/status/:restaurantId",
  getPublicTableStatus
);

/*
|--------------------------------------------------------------------------
| ADMIN
|--------------------------------------------------------------------------
*/

/*
 * Move table to another section
 *
 * IMPORTANT:
 * protect + authorize + tenantContext
 */
router.patch(
  "/admin/:tableNumber/section",
  protect,
  authorize(...TABLE_WRITE_ROLES),
  tenantContext,
  moveTableSection
);

router.get(
  "/status",
  protect,
  authorize(...TABLE_ADMIN_ROLES),
  tenantContext,
  getTableStatusForAdmin
);

router.get(
  "/admin",
  protect,
  authorize(...TABLE_ADMIN_ROLES),
  tenantContext,
  getAdminTableList
);

router.post(
  "/admin",
  protect,
  authorize(...TABLE_WRITE_ROLES),
  tenantContext,
  addAdminTable
);

router.patch(
  "/admin/:tableNumber/toggle",
  protect,
  authorize(...TABLE_WRITE_ROLES),
  tenantContext,
  toggleTableStatus
);

router.delete(
  "/admin/:tableNumber",
  protect,
  authorize(...TABLE_WRITE_ROLES),
  tenantContext,
  removeAdminTable
);

module.exports = router;