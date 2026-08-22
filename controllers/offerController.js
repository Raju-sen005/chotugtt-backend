const mongoose = require("mongoose");
const Offer = require("../models/Offer");
const MenuItem = require("../models/MenuItem");
const { emitToRestaurant } = require("../services/socketService");

const getRestaurantId = (req) => {
  const restaurantId = req.user?.restaurantId;

  if (!restaurantId) {
    return null;
  }

  return String(restaurantId?._id || restaurantId);
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

exports.createOffer = async (req, res) => {
  try {
    const restaurantId = getRestaurantId(req);

    if (!restaurantId || !isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant context",
      });
    }

    const { title, discountValue, description, targetItems } = req.body;

    // ---------------------------------------------
    // INPUT VALIDATION
    // ---------------------------------------------

    const cleanTitle = typeof title === "string" ? title.trim() : "";

    const cleanDescription =
      typeof description === "string" ? description.trim() : "";

    const discount = Number(discountValue);

    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        message: "Offer title is required",
      });
    }

    if (cleanTitle.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Offer title is too long",
      });
    }

    if (!Number.isFinite(discount) || discount <= 0 || discount > 100) {
      return res.status(400).json({
        success: false,
        message: "Discount value must be between 1 and 100",
      });
    }

    // ---------------------------------------------
    // TARGET ITEM VALIDATION
    // ---------------------------------------------

    const itemIds = Array.isArray(targetItems)
      ? [...new Set(targetItems.filter(Boolean).map(String))]
      : [];

    if (itemIds.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid target menu item",
      });
    }

    /*
     * IMPORTANT:
     *
     * Verify every target item belongs to
     * the authenticated restaurant.
     *
     * Never trust only the submitted ObjectIds.
     */

    if (itemIds.length > 0) {
      const validItems = await MenuItem.find({
        _id: {
          $in: itemIds,
        },
        restaurantId,
      })
        .select("_id")
        .lean();

      if (validItems.length !== itemIds.length) {
        return res.status(403).json({
          success: false,
          message: "One or more menu items are not accessible",
        });
      }
    }

    // ---------------------------------------------
    // CREATE OFFER
    // ---------------------------------------------

    const offer = await Offer.create({
      title: cleanTitle,
      discountValue: discount,
      description: cleanDescription,
      targetItems: itemIds,
      restaurantId,
    });

    /*
     * Tenant-safe realtime event.
     *
     * emitToRestaurant() only sends this to:
     *
     * restaurant:<restaurantId>
     */

    emitToRestaurant(restaurantId, "OFFER_CREATED", {
      offer,
    });

    return res.status(201).json({
      success: true,
      data: offer,
    });
  } catch (error) {
    console.error("Create Offer Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create offer",
    });
  }
};

exports.getOffers = async (req, res) => {
  try {
    const restaurantId = getRestaurantId(req);

    if (!restaurantId || !isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant context",
      });
    }

    const offers = await Offer.find({
      restaurantId,
    })
      .populate("targetItems", "name")
      .sort({
        createdAt: -1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      data: offers,
    });
  } catch (error) {
    console.error("Get Offers Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load offers",
    });
  }
};

exports.deleteOffer = async (req, res) => {
  try {
    const restaurantId = getRestaurantId(req);
    const offerId = req.params.id;

    if (!restaurantId || !isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant context",
      });
    }

    if (!isValidObjectId(offerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid offer ID",
      });
    }

    /*
     * CRITICAL TENANT CHECK
     *
     * The same _id in another restaurant
     * must never be accessible.
     */

    const offer = await Offer.findOneAndDelete({
      _id: offerId,
      restaurantId,
    }).lean();

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    emitToRestaurant(restaurantId, "OFFER_DELETED", {
      offerId: String(offer._id),
    });

    return res.status(200).json({
      success: true,
      message: "Offer deleted successfully",
      data: {
        id: String(offer._id),
      },
    });
  } catch (error) {
    console.error("Delete Offer Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to delete offer",
    });
  }
};
