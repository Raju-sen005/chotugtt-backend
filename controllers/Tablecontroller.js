const mongoose = require("mongoose");
const Order = require("../models/Order");
const Table = require("../models/Table");
const Section = require("../models/Section");
const { emitToRestaurant } = require("../services/socketService");

const Restaurant = require("../models/Restaurant");
const { signTableToken, isValidTableNumber } = require("../utils/tableToken");

exports.getAdminTableList = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    const [tables, restaurant] = await Promise.all([
      Table.find({ restaurantId })
        .select("tableNumber isActive section")
        .sort({ createdAt: 1 })
        .lean(),
      Restaurant.findById(restaurantId).select("qrTokenVersion").lean(),
    ]);
    const tokenVersion = restaurant?.qrTokenVersion || 0;

    const formattedTables = tables.map((t) => ({
      tableNumber: t.tableNumber,
      isDisabled: !t.isActive,
      section: t.section || "General",
      token: signTableToken({
        restaurantId,
        tableNumber: t.tableNumber,
        tokenVersion,
      }),
    }));

    res.status(200).json({ success: true, data: formattedTables });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Konse tables abhi free hain (customer merge-picker ke liye) — public
// @route   GET /tables/public/:restaurantId
exports.getPublicFreeTables = async (req, res) => {
  try {
    const { restaurantId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid restaurant ID" });
    }

    const allTables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber")
      .lean();

    const activeOrders = await Order.find({
      restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    }).select("tableNumber mergedTables");

    const occupiedSet = new Set();
    activeOrders.forEach((o) => {
      if (o.tableNumber && o.tableNumber !== "N/A")
        occupiedSet.add(String(o.tableNumber));
      (o.mergedTables || []).forEach((t) => occupiedSet.add(String(t)));
    });

    const freeTables = allTables
      .map((t) => t.tableNumber)
      .filter((num) => !occupiedSet.has(String(num)));

    res.status(200).json({ success: true, data: freeTables });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Sabhi tables ki live status (free/occupied + kisne occupy kiya) — admin dashboard
// @route   GET /tables/status
exports.getTableStatusForAdmin = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    const allTables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber section")
      .sort({ createdAt: 1 })
      .lean();

    const activeOrders = await Order.find({
      restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    }).select("_id tableNumber mergedTables orderId customerName");

    const occupiedMap = {};
    activeOrders.forEach((o) => {
      const involvedTables = [o.tableNumber, ...(o.mergedTables || [])].filter(
        (t) => t && t !== "N/A",
      );
      involvedTables.forEach((t) => {
        occupiedMap[String(t)] = {
          orderMongoId: o._id,
          orderId: o.orderId,
          customerName: o.customerName,
          mergedWith: involvedTables.filter((x) => String(x) !== String(t)),
        };
      });
    });

    const status = allTables.map((t) => ({
      tableNumber: t.tableNumber,
      section: t.section,
      isOccupied: !!occupiedMap[String(t.tableNumber)],
      occupiedBy: occupiedMap[String(t.tableNumber)] || null,
    }));

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @route POST /tables/admin/regenerate-tokens  (OWNER only)
exports.regenerateAllTableTokens = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const restaurant = await Restaurant.findByIdAndUpdate(
      restaurantId,
      { $inc: { qrTokenVersion: 1 } },
      { new: true },
    ).select("qrTokenVersion");

    emitToRestaurant(restaurantId, "TABLES_UPDATED", {
      action: "TOKENS_REGENERATED",
    });
    res
      .status(200)
      .json({ success: true, qrTokenVersion: restaurant.qrTokenVersion });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Naya table add karna — custom naam + section ke saath
// @route   POST /tables/admin   body: { tableNumber, section }
exports.addAdminTable = async (req, res) => {
  try {
    const { tableNumber, section } = req.body;
    if (!tableNumber || !String(tableNumber).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "tableNumber is required" });
    }

    const clean = String(tableNumber).trim();
    if (!isValidTableNumber(clean)) {
      return res.status(400).json({
        success: false,
        message: "Table name can't contain ':' or '.' characters",
      });
    }
    const cleanSection =
      section && String(section).trim() ? String(section).trim() : "General";
    const restaurantId = req.user.restaurantId;

    const existing = await Table.findOne({ restaurantId, tableNumber: clean });

    if (existing) {
      if (!existing.isActive) {
        // Agar soft-deleted/disabled thi, toh use active kar dein aur naya section apply kar dein
        existing.isActive = true;
        existing.section = cleanSection;
        await existing.save();
      } else {
        return res
          .status(400)
          .json({ success: false, message: "This table name already exists" });
      }
    } else {
      await Table.create({
        restaurantId,
        tableNumber: clean,
        section: cleanSection,
        isActive: true,
      });
    }

    // 🔑 Agar yeh section pehli baar use ho raha hai, toh usko Section list mein bhi upsert kar dein
    // taaki dropdown mein turant dikhe (chahe koi explicit "Create Section" na kiya ho)
    await Section.findOneAndUpdate(
      { restaurantId, name: cleanSection },
      { $setOnInsert: { restaurantId, name: cleanSection, order: 0 } },
      { upsert: true },
    );

    const restaurant = await Restaurant.findById(restaurantId)
      .select("qrTokenVersion")
      .lean();
    const tokenVersion = restaurant?.qrTokenVersion || 0;

    const tables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber isActive section")
      .sort({ createdAt: 1 })
      .lean();

    const formattedTables = tables.map((t) => ({
      tableNumber: t.tableNumber,
      isDisabled: !t.isActive,
      section: t.section || "General",
      token: signTableToken({
        restaurantId,
        tableNumber: t.tableNumber,
        tokenVersion,
      }),
    }));
    emitToRestaurant(restaurantId, "TABLES_UPDATED", {
      action: "CREATED",
      table: {
        tableNumber: clean,
        section: cleanSection,
        isDisabled: false,
      },
    });
    res.status(200).json({ success: true, data: formattedTables });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ success: false, message: "This table name already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Table remove karna (hard delete — history/orders tableNumber string se hi linked rehte hain)
// @route   DELETE /tables/admin/:tableNumber
exports.removeAdminTable = async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const restaurantId = req.user.restaurantId;

    await Table.findOneAndDelete({
      restaurantId,
      tableNumber: String(tableNumber),
    });

    const tables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber isActive section")
      .sort({ createdAt: 1 })
      .lean();

    const formattedTables = tables.map((t) => ({
      tableNumber: t.tableNumber,
      isDisabled: !t.isActive,
      section: t.section || "General",
    }));

    emitToRestaurant(restaurantId, "TABLES_UPDATED", {
      action: "DELETED",
      tableNumber: String(tableNumber),
    });
    res.status(200).json({ success: true, data: formattedTables });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Table ko enable ya disable (lock/unlock) karna
// @route   PATCH /tables/admin/:tableNumber/toggle
exports.toggleTableStatus = async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const { isDisabled } = req.body;
    const restaurantId = req.user.restaurantId;

    const table = await Table.findOne({
      restaurantId,
      tableNumber: String(tableNumber),
    });
    if (!table) {
      return res
        .status(404)
        .json({ success: false, message: "Table not found" });
    }

    table.isActive = !isDisabled;
    await table.save();

    emitToRestaurant(restaurantId, "TABLE_STATUS_UPDATED", {
      tableNumber: String(tableNumber),
      isActive: table.isActive,
      isDisabled: !table.isActive,
    });

    res.status(200).json({
      success: true,
      message: "Table status updated",
      isActive: table.isActive,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Table ka section badalna (drag/move to another section)
// @route   PATCH /tables/admin/:tableNumber/section   body: { section }
exports.moveTableSection = async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const { section } = req.body;
    const restaurantId = req.user.restaurantId;

    if (!section || !String(section).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "section is required" });
    }
    const cleanSection = String(section).trim();

    const table = await Table.findOne({
      restaurantId,
      tableNumber: String(tableNumber),
    });
    if (!table) {
      return res
        .status(404)
        .json({ success: false, message: "Table not found" });
    }

    table.section = cleanSection;
    await table.save();

    await Section.findOneAndUpdate(
      { restaurantId, name: cleanSection },
      { $setOnInsert: { restaurantId, name: cleanSection, order: 0 } },
      { upsert: true },
    );

    emitToRestaurant(restaurantId, "TABLES_UPDATED", {
      action: "SECTION_MOVED",
      tableNumber: String(tableNumber),
      section: table.section,
    });
    res
      .status(200)
      .json({ success: true, message: "Table moved", section: table.section });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Restaurant ki saari tables with live status fetch karna (Public / Captain POS ke liye)
// @route   GET /tables/status/:restaurantId
exports.getPublicTableStatus = async (req, res) => {
  try {
    const { restaurantId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid restaurant ID" });
    }

    const allTables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber section")
      .sort({ createdAt: 1 })
      .lean();

    const activeOrders = await Order.find({
      restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    }).select("_id tableNumber mergedTables"); // 🔑 orderId/customerName ab select hi nahi kar rahe

    const occupiedMap = {};
    activeOrders.forEach((o) => {
      const involvedTables = [o.tableNumber, ...(o.mergedTables || [])].filter(
        (t) => t && t !== "N/A",
      );
      involvedTables.forEach((t) => {
        // 🔑 FIX: public response mein sirf ye zaroori info — customer PII nahi
        occupiedMap[String(t)] = {
          mergedWith: involvedTables.filter((x) => String(x) !== String(t)),
        };
      });
    });

    const status = allTables.map((t) => {
      const tableName = String(t.tableNumber);
      const isOcc = !!occupiedMap[tableName];
      return {
        tableNumber: t.tableNumber,
        section: t.section,
        status: isOcc ? "Running" : "Available",
        isOccupied: isOcc,
        occupiedBy: occupiedMap[tableName] || null,
      };
    });

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
