const express = require("express");

const router = express.Router();

const {
  getStaff,
  createStaff,
  updateStaff,
  toggleStaffStatus,
  deleteStaff,
} = require("../controllers/staffController");

const {
  protect,
  authorize,
} = require("../middleware/auth");

const tenantContext = require("../middleware/tenant");

/*
|--------------------------------------------------------------------------
| STAFF / CAPTAIN MANAGEMENT
|--------------------------------------------------------------------------
|
| OWNER:
|   Full access
|
| MANAGER:
|   Create/edit/disable
|
| STAFF:
|   No access
|
*/

/*
|--------------------------------------------------------------------------
| GET ALL CAPTAINS
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  getStaff
);

/*
|--------------------------------------------------------------------------
| CREATE CAPTAIN
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  createStaff
);

/*
|--------------------------------------------------------------------------
| UPDATE CAPTAIN
|--------------------------------------------------------------------------
*/

router.patch(
  "/:staffId",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  updateStaff
);

/*
|--------------------------------------------------------------------------
| ENABLE / DISABLE CAPTAIN
|--------------------------------------------------------------------------
*/

router.patch(
  "/:staffId/status",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  toggleStaffStatus
);

/*
|--------------------------------------------------------------------------
| DELETE CAPTAIN
|--------------------------------------------------------------------------
|
| Only OWNER should permanently delete accounts.
|
*/

router.delete(
  "/:staffId",
  protect,
  authorize("OWNER"),
  tenantContext,
  deleteStaff
);

module.exports = router;