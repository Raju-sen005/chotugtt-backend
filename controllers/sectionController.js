const Section = require("../models/Section");
const Table = require("../models/Table");

// @desc    Sabhi sections list karna, saath mein har section ki table count
// @route   GET /sections/admin
exports.getSections = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    const sections = await Section.find({ restaurantId })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    // Har section ke against active table count nikal lein (UI mein dikhane ke liye)
    const counts = await Table.aggregate([
      { $match: { restaurantId, isActive: true } },
      { $group: { _id: "$section", count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => (countMap[c._id] = c.count));

    const formatted = sections.map((s) => ({
      _id: s._id,
      name: s.name,
      order: s.order,
      tableCount: countMap[s.name] || 0,
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Naya (khali) section banana
// @route   POST /sections/admin   body: { name }
exports.createSection = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Section name is required" });
    }
    const clean = String(name).trim();
    const restaurantId = req.user.restaurantId;

    const existing = await Section.findOne({ restaurantId, name: clean });
    if (existing) {
      return res.status(400).json({ success: false, message: "This section already exists" });
    }

    const count = await Section.countDocuments({ restaurantId });
    await Section.create({ restaurantId, name: clean, order: count });

    const sections = await Section.find({ restaurantId }).sort({ order: 1, createdAt: 1 }).lean();
    res.status(200).json({ success: true, data: sections });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "This section already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Section ka naam change karna (uske tables ka section bhi sync ho jayega)
// @route   PATCH /sections/admin/:name   body: { newName }
exports.renameSection = async (req, res) => {
  try {
    const { name } = req.params;
    const { newName } = req.body;
    const restaurantId = req.user.restaurantId;

    if (!newName || !String(newName).trim()) {
      return res.status(400).json({ success: false, message: "New section name is required" });
    }
    const clean = String(newName).trim();

    const section = await Section.findOne({ restaurantId, name });
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }

    const duplicate = await Section.findOne({ restaurantId, name: clean });
    if (duplicate) {
      return res.status(400).json({ success: false, message: "A section with this name already exists" });
    }

    section.name = clean;
    await section.save();

    // Is section ke saare tables ko naye naam se update karein
    await Table.updateMany({ restaurantId, section: name }, { $set: { section: clean } });

    res.status(200).json({ success: true, message: "Section renamed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Section delete karna — tables usme hon toh unhe "General" mein move kar dein
// @route   DELETE /sections/admin/:name
exports.deleteSection = async (req, res) => {
  try {
    const { name } = req.params;
    const restaurantId = req.user.restaurantId;

    if (name === "General") {
      return res.status(400).json({ success: false, message: "Default section can't be deleted" });
    }

    const section = await Section.findOne({ restaurantId, name });
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }

    // Is section ki tables ko General mein daal dein (data loss avoid karne ke liye)
    await Table.updateMany({ restaurantId, section: name }, { $set: { section: "General" } });
    await Section.deleteOne({ _id: section._id });

    res.status(200).json({ success: true, message: "Section deleted, its tables moved to General" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};