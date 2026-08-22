const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/analyticsController');
const { protect, authorize } = require("../middleware/auth");
const tenantContext = require("../middleware/tenant");

router.get(
  "/summary",
  protect,
  authorize("OWNER", "MANAGER", "STAFF"),
  tenantContext,
  getDashboardStats
);

module.exports = router;