const mongoose = require("mongoose");
const Order = require("../models/Order");
const Table = require("../models/Table");

// @desc    Konse tables abhi free hain (customer merge-picker ke liye) — public
// @route   GET /tables/public/:restaurantId
exports.getPublicFreeTables = async (req, res) => {
  try {
    const { restaurantId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res.status(400).json({ success: false, message: "Invalid restaurant ID" });
    }

    const allTables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber")
      .lean();

    // Active order ki tableNumber + mergedTables sab occupied maane jaate hain
    const activeOrders = await Order.find({
      restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    }).select("tableNumber mergedTables");

    const occupiedSet = new Set();
    activeOrders.forEach((o) => {
      if (o.tableNumber && o.tableNumber !== "N/A") occupiedSet.add(String(o.tableNumber));
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
      .select("tableNumber")
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
      isOccupied: !!occupiedMap[String(t.tableNumber)],
      occupiedBy: occupiedMap[String(t.tableNumber)] || null,
    }));

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin ke table list ko fetch karna (StoreSettings load pe)
// @route   GET /tables/admin
exports.getAdminTableList = async (req, res) => {
  try {
    const tables = await Table.find({
      restaurantId: req.user.restaurantId,
    })
      .select("tableNumber isActive")
      .sort({ createdAt: 1 })
      .lean();

    // Frontend ke format ke mutabiq map karein (isActive: true means isDisabled: false)
    const formattedTables = tables.map((t) => ({
      tableNumber: t.tableNumber,
      isDisabled: !t.isActive,
    }));

    res.status(200).json({ success: true, data: formattedTables });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Naya table add karna
// @route   POST /tables/admin   body: { tableNumber }
exports.addAdminTable = async (req, res) => {
  try {
    const { tableNumber } = req.body;
    if (!tableNumber || !String(tableNumber).trim()) {
      return res.status(400).json({ success: false, message: "tableNumber is required" });
    }

    const clean = String(tableNumber).trim();
    const restaurantId = req.user.restaurantId;

    // Check karein ki kya ye table pehle se exist karti hai (chahe inactive ho)
    const existing = await Table.findOne({ restaurantId, tableNumber: clean });
    
    if (existing) {
      if (!existing.isActive) {
        // Agar soft-deleted thi, toh use active kar dein
        existing.isActive = true;
        await existing.save();
      } else {
        // Agar pehle se active hai, toh error bhej dein
        return res.status(400).json({ success: false, message: "This table already exists" });
      }
    } else {
      // Nayi table create karein
      await Table.create({ restaurantId, tableNumber: clean, isActive: true });
    }

    // Sabhi active tables return karein
    const tables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber isActive")
      .sort({ createdAt: 1 })
      .lean();

    const formattedTables = tables.map((t) => ({
      tableNumber: t.tableNumber,
      isDisabled: !t.isActive,
    }));

    res.status(200).json({ success: true, data: formattedTables });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "This table already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Table remove karna (soft delete — history/orders intact rehte hain)
// @route   DELETE /tables/admin/:tableNumber
exports.removeAdminTable = async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const restaurantId = req.user.restaurantId;

    // Hard delete taaki unique index ka issue na aaye
    await Table.findOneAndDelete({ restaurantId, tableNumber: String(tableNumber) });

    const tables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber isActive")
      .sort({ createdAt: 1 })
      .lean();

    const formattedTables = tables.map((t) => ({
      tableNumber: t.tableNumber,
      isDisabled: !t.isActive,
    }));

    res.status(200).json({ success: true, data: formattedTables });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};




// @desc    Table ko enable ya disable (lock/unlock) karna
// @route   PATCH /tables/admin/:tableNumber/toggle
// @desc    Table ko enable ya disable (lock/unlock) karna
// @route   PATCH /tables/admin/:tableNumber/toggle
exports.toggleTableStatus = async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const { isDisabled } = req.body; // Frontend se isDisabled aa raha hai
    const restaurantId = req.user.restaurantId;

    const table = await Table.findOne({ restaurantId, tableNumber: String(tableNumber) });
    if (!table) {
      return res.status(404).json({ success: false, message: "Table not found" });
    }

    // Agar isDisabled true hai toh isActive false hoga, aur vice-versa
    table.isActive = !isDisabled;
    await table.save();

    res.status(200).json({ success: true, message: "Table status updated", isActive: table.isActive });
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
      return res.status(400).json({ success: false, message: "Invalid restaurant ID" });
    }

    const allTables = await Table.find({ restaurantId, isActive: true })
      .select("tableNumber")
      .sort({ createdAt: 1 })
      .lean();

    const activeOrders = await Order.find({
      restaurantId,
      status: { $in: ["PENDING", "ACCEPTED"] },
    }).select("_id tableNumber mergedTables orderId customerName");

    const occupiedMap = {};
    activeOrders.forEach((o) => {
      const involvedTables = [o.tableNumber, ...(o.mergedTables || [])].filter(
        (t) => t && t !== "N/A"
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

    const status = allTables.map((t) => {
      const tableName = String(t.tableNumber);
      const isOcc = !!occupiedMap[tableName];
      return {
        tableNumber: t.tableNumber,
        status: isOcc ? "Running" : "Available", // Captain POS ke format ke mutabiq
        isOccupied: isOcc,
        occupiedBy: occupiedMap[tableName] || null,
      };
    });

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};