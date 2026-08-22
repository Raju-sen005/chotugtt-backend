const express = require("express");

const router = express.Router();

const {
  createOffer,
  getOffers,
  deleteOffer,
} = require("../controllers/offerController");

const { protect, authorize } = require("../middleware/auth");

const tenantContext = require("../middleware/tenant");

const OFFER_ROLES = ["OWNER", "MANAGER", "STAFF"];

router.get("/", protect, authorize(...OFFER_ROLES), tenantContext, getOffers);

router.post(
  "/",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  createOffer,
);

router.delete(
  "/:id",
  protect,
  authorize("OWNER", "MANAGER"),
  tenantContext,
  deleteOffer,
);

module.exports = router;
