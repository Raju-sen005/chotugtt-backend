const express = require("express");
const router = express.Router();
const {
  handleIncomingReview,
  createSocialDraft,
  approveAndPublishPost,
} = require("../controllers/marketingController");
const { protect } = require("../middleware/auth");

router.post("/reviews", protect, handleIncomingReview);
router.post("/social/generate", protect, createSocialDraft);
// Social Media Routes
router.post('/social/generate', createSocialDraft);
router.put('/social/publish/:postId', approveAndPublishPost);

// AI Review & Auto-Reply Route
router.post('/reviews/incoming', handleIncomingReview);
router.put("/social/publish/:postId", approveAndPublishPost);
module.exports = router;
