const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth"); // apka actual auth middleware yahan lagayein
const {
  getSections,
  createSection,
  renameSection,
  deleteSection,
} = require("../controllers/sectionController");
 
router.get("/admin", protect, getSections);
router.post("/admin", protect, createSection);
router.patch("/admin/:name", protect, renameSection);
router.delete("/admin/:name", protect, deleteSection);

module.exports = router;
