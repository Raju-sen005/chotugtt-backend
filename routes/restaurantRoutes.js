const express = require("express");

const router = express.Router();

const {
  updateRestaurantProfile,
  getPublicRestaurantDetails,
  getRestaurantProfile,
} = require("../controllers/restaurantController");

const {
  protect,
  authorize,
} = require("../middleware/auth");

const tenantContext =
  require("../middleware/tenant");

const upload =
  require("../middleware/upload");

/*
|--------------------------------------------------------------------------
| ADMIN PROFILE READ
|--------------------------------------------------------------------------
*/

router.get(
  "/profile",
  protect,
  authorize(
    "OWNER",
    "MANAGER"
  ),
  tenantContext,
  getRestaurantProfile
);

/*
|--------------------------------------------------------------------------
| ADMIN PROFILE UPDATE
|--------------------------------------------------------------------------
|
| OWNER + MANAGER
|
| If only OWNER should be allowed to
| change UPI/business identity, create
| a separate OWNER-only endpoint later.
|
*/

router.patch(
  "/profile",
  protect,
  authorize(
    "OWNER",
    "MANAGER"
  ),
  tenantContext,
  upload.single("logo"),
  updateRestaurantProfile
);

/*
|--------------------------------------------------------------------------
| PUBLIC RESTAURANT
|--------------------------------------------------------------------------
*/

router.get(
  "/public/:slug",
  getPublicRestaurantDetails
);

module.exports = router;