const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getSections,
  createSection,
  renameSection,
  deleteSection,
} = require("../controllers/sectionController");
const tenantContext = require("../middleware/tenant");

const SECTION_ADMIN_ROLES = ["OWNER", "MANAGER", "STAFF"];
const SECTION_WRITE_ROLES = ["OWNER", "MANAGER"];
router.get(
  "/admin",
  protect,
  authorize(...SECTION_ADMIN_ROLES),
  tenantContext,
  getSections,
);
router.post(
  "/admin",
  protect,
  authorize(...SECTION_WRITE_ROLES),
  tenantContext,
  createSection,
);
router.patch(
  "/admin/:name",
  protect,
  authorize(...SECTION_WRITE_ROLES),
  tenantContext,
  renameSection,
);
router.delete(
  "/admin/:name",
  protect,
  authorize(...SECTION_WRITE_ROLES),
  tenantContext,
  deleteSection,
);

module.exports = router;
