const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const Combo = require("../models/Combo");
const Offer = require("../models/Offer");
// const cloudinary = require('../config/cloudinary'); // Agar Cloudinary use kar rahe hain

// --- ADMIN MENU ACTIONS ---

exports.createMenuItem = async (req, res) => {
  try {
    const { name, category, description, price } = req.body;
    
    // Multer se aayi file ka URL/path yahan handle hoga (Example: Cloudinary ya local storage link)
    let imageUrl = "";
    if (req.file) {
      // 🔑 Yahan check karein ki filename ki jagah originalname ya path use ho raha hai ya nahi
      imageUrl = `/uploads/${req.file.filename || req.file.originalname}`;
    }

    const item = await MenuItem.create({
      restaurantId: req.user.restaurantId,
      name,
      category,
      description,
      price,
      image: imageUrl,
    });
console.log("REQ FILE:", req.file)
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminMenuItems = async (req, res) => {
  try {
    const items = await MenuItem.find({ restaurantId: req.user.restaurantId });
    res.status(200).json({ success: true, count: items.length, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateMenuItem = async (req, res) => {
  try {
    const updates = { ...req.body };
    
    if (req.file) {
      updates.image = `/uploads/${req.file.filename}`; // Ya Cloudinary URL
    }

    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.user.restaurantId },
      { $set: updates },
      { new: true },
    );

    if (!item)
      return res.status(404).json({ success: false, message: "Item not found in your catalog" });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMenuItem = async (req, res) => {
  try {
    const item = await MenuItem.findOneAndDelete({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
    });
    if (!item)
      return res.status(404).json({ success: false, message: "Item not found" });
    res.status(200).json({ success: true, message: "Menu item discarded successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- COMBO ACTIONS ---

exports.createCombo = async (req, res) => {
  try {
    const { name, description, items, price, discount } = req.body;
    
    let imageUrl = "";
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const combo = await Combo.create({
      restaurantId: req.user.restaurantId,
      name,
      description,
      items: typeof items === 'string' ? JSON.parse(items) : items, // FormData parsing fix
      price,
      discount,
      category: "COMBO",
      image: imageUrl,
    });
    res.status(201).json({ success: true, data: combo });
  } catch (error)  {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminCombos = async (req, res) => {
  try {
    const combos = await Combo.find({ restaurantId: req.user.restaurantId });
    res.status(200).json({ success: true, count: combos.length, data: combos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateCombo = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.items && typeof updates.items === 'string') {
      updates.items = JSON.parse(updates.items);
    }
    if (req.file) {
      updates.image = `/uploads/${req.file.filename}`;
    }

    const combo = await Combo.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.user.restaurantId },
      { $set: updates },
      { new: true },
    );
    if (!combo)
      return res.status(404).json({ success: false, message: "Combo not found" });
    res.status(200).json({ success: true, data: combo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCombo = async (req, res) => {
  try {
    const combo = await Combo.findOneAndDelete({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
    });
    if (!combo)
      return res.status(404).json({ success: false, message: "Combo not found" });
    res.status(200).json({ success: true, message: "Combo discarded successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- PUBLIC VIEWING TARGETS ---
exports.getPublicCatalog = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const [restaurant] = await Promise.all([Restaurant.findById(restaurantId)]);

    if (!restaurant) {
      return res.status(404).json({ success: false, message: "Restaurant not found" });
    }
    const activeItems = await MenuItem.find({ restaurantId, isAvailable: true });
    const activeCombos = await Combo.find({ restaurantId, isAvailable: true }).populate("items", "name price image");
    const activeOffers = await Offer.find({ restaurantId, isActive: true });

    const groupedMenu = activeItems.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        restaurant: {
          name: restaurant.name,
          address: restaurant.address,
          logo: restaurant.logo,
          timings: restaurant.timings,
        },
        categories: groupedMenu,
        combos: activeCombos,
        offers: activeOffers,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};