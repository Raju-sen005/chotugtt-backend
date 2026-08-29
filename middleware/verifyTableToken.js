const { verifyTableToken } = require("../utils/tableToken");
const Restaurant = require("../models/Restaurant");

function verifyTableTokenMiddleware({ required = false } = {}) {
  return async (req, res, next) => {
    const token = req.query.t || req.body.tableToken;
    const restaurantId = req.params.restaurantId || req.body.restaurantId;

    if (!token) {
      if (required) {
        return res.status(400).json({ success: false, message: "Table token is required" });
      }
      return next(); // pickup/delivery flow — no table token needed
    }

    const result = verifyTableToken(token);
    if (!result.valid) {
      return res.status(400).json({ success: false, message: "Invalid or tampered table QR" });
    }
    if (String(result.restaurantId) !== String(restaurantId)) {
      return res.status(400).json({ success: false, message: "This QR does not belong to this restaurant" });
    }

    const restaurant = await Restaurant.findById(restaurantId).select("qrTokenVersion").lean();
    if (!restaurant) {
      return res.status(404).json({ success: false, message: "Restaurant not found" });
    }
    if ((restaurant.qrTokenVersion || 0) !== result.tokenVersion) {
      return res.status(400).json({ success: false, message: "This QR has expired. Please rescan the table QR." });
    }

    req.tableContext = { restaurantId: result.restaurantId, tableNumber: result.tableNumber };
    next();
  };
}

module.exports = verifyTableTokenMiddleware;