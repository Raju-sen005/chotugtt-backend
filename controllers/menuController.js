const mongoose = require("mongoose");
const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const Combo = require("../models/Combo");
const Offer = require("../models/Offer");
const Table = require("../models/Table");
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs/promises");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const GEMINI_MODEL = "gemini-flash-latest";
const MAX_ITEMS_PER_UPLOAD = 60; // Abuse/cost protection — ek menu image se itne se zyada items expected nahi
const PEXELS_TIMEOUT_MS = 6000;
const FALLBACK_IMAGE =
  "https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=400";

// ============================================================
// HELPERS
// ============================================================

/**
 * Pexels se dish/combo naam ke hisaab se matching food photo fetch karta hai.
 * - Timeout guard (Pexels slow ho to poori request hang na ho)
 * - Same-name dishes ke liye cache (duplicate API calls avoid)
 */
function createImageFetcher() {
  const cache = new Map(); // naam -> imageUrl (isi request ke andar reuse)

  return async function fetchDishImage(rawQuery) {
    const query = (rawQuery || "food").trim().toLowerCase();
    if (cache.has(query)) return cache.get(query);

    if (!process.env.PEXELS_API_KEY) {
      cache.set(query, FALLBACK_IMAGE);
      return FALLBACK_IMAGE;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PEXELS_TIMEOUT_MS);

    try {
      const searchQuery = encodeURIComponent(`${query} food dish`);
      const response = await fetch(
        `https://api.pexels.com/v1/search?query=${searchQuery}&per_page=1&orientation=square`,
        {
          headers: { Authorization: process.env.PEXELS_API_KEY },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        cache.set(query, FALLBACK_IMAGE);
        return FALLBACK_IMAGE;
      }

      const data = await response.json();
      const imageUrl = data.photos?.[0]?.src?.medium || FALLBACK_IMAGE;
      cache.set(query, imageUrl);
      return imageUrl;
    } catch (err) {
      console.error(`Pexels fetch failed for "${query}":`, err.message);
      cache.set(query, FALLBACK_IMAGE);
      return FALLBACK_IMAGE;
    } finally {
      clearTimeout(timeout);
    }
  };
}

/** Ek AI-extracted raw item ko safe, sanitized shape mein normalize karta hai. */
function sanitizeExtractedItem(raw) {
  const name =
    String(raw?.name || "")
      .trim()
      .slice(0, 120) || "Untitled Item";
  const description = String(raw?.description || "")
    .trim()
    .slice(0, 300);
  const priceNum = Number(raw?.price);
  const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0;
  const categoryRaw = String(raw?.category || "").trim();
  const isCombo =
    raw?.isCombo === true || categoryRaw.toUpperCase() === "COMBO";
  const category = isCombo
    ? "COMBO"
    : categoryRaw
      ? categoryRaw.slice(0, 60)
      : "General";

  return { name, description, price, category, isCombo };
}

/** Gemini ke response text se clean JSON array parse karta hai (markdown fences hata ke). */
function parseAiJsonArray(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned
      .replace(/^```json/, "")
      .replace(/```$/, "")
      .trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error("AI response wasn't valid JSON — try a clearer photo.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI response wasn't a JSON array — try a clearer photo.");
  }

  return parsed;
}

// ============================================================
// ADMIN MENU ACTIONS
// ============================================================

exports.createMenuItem = async (req, res) => {
  try {
    const { name, category, description, price } = req.body;

    let imageUrl = "";
    if (req.file) {
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
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Menu image upload karke AI se dishes + combos extract karta hai.
 * - Dishes -> MenuItem collection (unki asli category ke saath)
 * - Combos -> Combo collection (category "COMBO")
 * - Har item ke liye matching photo Pexels se fetch hoti hai
 * - Poori operation ek MongoDB transaction mein hoti hai (dono collections consistent rahein)
 */
exports.extractMenuFromImage = async (req, res) => {
  let uploadedFilePath = null;

  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Please upload a menu image." });
    }

    uploadedFilePath = req.file.path;

    if (!req.file.mimetype?.startsWith("image/")) {
      return res
        .status(400)
        .json({ success: false, message: "Uploaded file must be an image." });
    }

    const imageBuffer = await fs.readFile(req.file.path);
    const base64Image = imageBuffer.toString("base64");

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          inlineData: {
            data: base64Image,
            mimeType: req.file.mimetype,
          },
        },
        {
          text: `Analyze this restaurant menu image carefully. Extract every food item, thali, and combo/meal deal visible.

Return the result STRICTLY as a raw JSON array (no markdown, no code blocks) of objects with these exact keys:
- name (string)
- category (string — e.g. Starters, Main Course, Beverages, Desserts. If it's a combo/thali/meal deal, set category to "COMBO")
- description (string — write a short, appetizing 1-line description if not explicitly visible on the menu)
- price (number)
- isCombo (boolean — true if this is a combo/thali/meal-deal bundling multiple dishes together, false for a single dish)

Do not include any text before or after the JSON array.`,
        },
      ],
    });

    if (!response?.text) {
      return res.status(502).json({
        success: false,
        message: "AI didn't return a response. Please try again.",
      });
    }

    const rawItems = parseAiJsonArray(response.text);

    if (rawItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Could not extract items from the image. Try a clearer photo.",
      });
    }

    const limitedItems = rawItems.slice(0, MAX_ITEMS_PER_UPLOAD);
    const sanitized = limitedItems.map(sanitizeExtractedItem);

    const dishes = sanitized.filter((item) => !item.isCombo);
    const combos = sanitized.filter((item) => item.isCombo);

    const fetchDishImage = createImageFetcher();

    const dishDocs = await Promise.all(
      dishes.map(async (item) => ({
        restaurantId: req.user.restaurantId,
        name: item.name,
        category: item.category,
        description: item.description || "Delicious freshly prepared dish.",
        price: item.price,
        image: await fetchDishImage(item.name),
        isAvailable: true,
      })),
    );

    const comboDocs = await Promise.all(
      combos.map(async (item) => ({
        restaurantId: req.user.restaurantId,
        name: item.name,
        description: item.description || "A delicious combo meal deal.",
        price: item.price,
        category: "COMBO",
        image: await fetchDishImage(item.name),
        items: [], // Component dishes ke valid ObjectIds AI reliably nahi bana sakta — admin manually link karega
        isAvailable: true,
      })),
    );

    // Transaction: dono collections mein insert ek saath succeed/fail ho
    const session = await mongoose.startSession();
    let insertedItems = [];
    let insertedCombos = [];

    try {
      await session.withTransaction(async () => {
        if (dishDocs.length) {
          insertedItems = await MenuItem.insertMany(dishDocs, { session });
        }
        if (comboDocs.length) {
          insertedCombos = await Combo.insertMany(comboDocs, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    res.status(201).json({
      success: true,
      message: `${insertedItems.length} dishes aur ${insertedCombos.length} combos successfully imported!`,
      data: { items: insertedItems, combos: insertedCombos },
    });
  } catch (error) {
    console.error("AI Menu Extraction Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process menu image with AI.",
    });
  } finally {
    // Temp uploaded file cleanup — chahe success ho ya fail, disk pe junk nahi rehna chahiye
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath).catch((err) =>
        console.error("Failed to clean up temp upload:", err.message),
      );
    }
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
      updates.image = `/uploads/${req.file.filename}`;
    }

    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.user.restaurantId },
      { $set: updates },
      { new: true },
    );

    if (!item)
      return res
        .status(404)
        .json({ success: false, message: "Item not found in your catalog" });
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
      return res
        .status(404)
        .json({ success: false, message: "Item not found" });
    res
      .status(200)
      .json({ success: true, message: "Menu item discarded successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// COMBO ACTIONS
// ============================================================

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
      items: typeof items === "string" ? JSON.parse(items) : items,
      price,
      discount,
      category: "COMBO",
      image: imageUrl,
    });
    res.status(201).json({ success: true, data: combo });
  } catch (error) {
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
    if (updates.items && typeof updates.items === "string") {
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
      return res
        .status(404)
        .json({ success: false, message: "Combo not found" });
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
      return res
        .status(404)
        .json({ success: false, message: "Combo not found" });
    res
      .status(200)
      .json({ success: true, message: "Combo discarded successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// PUBLIC VIEWING TARGETS
// ============================================================

exports.getPublicCatalog = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const tableToken = req.query.t;
    const [restaurant] = await Promise.all([Restaurant.findById(restaurantId)]);

    if (!restaurant) {
      return res
        .status(404)
        .json({ success: false, message: "Restaurant not found" });
    }
    let tableNumber = null;

    if (tableToken) {
      try {
        const decoded = Buffer.from(tableToken, "base64").toString("utf8");
        tableNumber = decoded.split("-TABLE-")[1];
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: "Invalid QR Code",
        });
      }
    }

    if (tableNumber) {
      const table = await Table.findOne({ restaurantId, tableNumber });

      if (!table) {
        return res.status(404).json({
          success: false,
          message: "Table not found",
        });
      }

      if (!table.isActive) {
        return res.status(403).json({
          success: false,
          code: "TABLE_DISABLED",
          message: "This table is temporarily blocked.",
        });
      }
    }

    const activeItems = await MenuItem.find({
      restaurantId,
      isAvailable: true,
    });
    const activeCombos = await Combo.find({
      restaurantId,
      isAvailable: true,
    }).populate("items", "name price image");
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
