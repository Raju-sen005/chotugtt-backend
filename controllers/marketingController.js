const Review = require('../models/Review');
const SocialPost = require('../models/SocialPost');
const { analyzeReviewAndDraftReply, generateSocialContent } = require('../services/aiMarketingService');

// 1. New Review Receive & AI Process
// 1. New Review Receive & AI Process
exports.handleIncomingReview = async (req, res) => {
  try {
    const { restaurantId, authorName, rating, comment } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ success: false, message: "Restaurant ID is required." });
    }

    // AI Analysis call via Gemini service
    const aiAnalysis = await analyzeReviewAndDraftReply(comment, rating);

    const review = new Review({
      restaurantId,
      authorName,
      rating,
      comment,
      sentiment: aiAnalysis.sentiment,
      category: aiAnalysis.category,
      severity: aiAnalysis.severity,
      aiReply: aiAnalysis.suggestedReply,
      isComplaint: aiAnalysis.isComplaint,
      replyStatus: 'Pending'
    });

    await review.save();
    res.status(201).json({ 
      success: true, 
      message: "Review analyzed and saved successfully!", 
      data: review 
    });
  } catch (error) {
    console.error("Error in handleIncomingReview:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Generate Social Media Post via AI
exports.createSocialDraft = async (req, res) => {
  try {
    const { restaurantId, contentType, details, platform } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ success: false, message: "Restaurant ID is required in request body." });
    }

    const aiContent = await generateSocialContent(contentType, details);

    const post = new SocialPost({
      restaurantId,
      platform: platform || 'Instagram',
      contentType,
      caption: aiContent.caption,
      hashtags: aiContent.hashtags,
      imagePrompt: aiContent.imagePrompt,
      status: 'Draft'
    });

    await post.save();
    res.status(201).json({ success: true, data: post });
  } catch (error) {
    console.error("Error in createSocialDraft:", error); // Terminal mein exact error dikhegi
    res.status(500).json({ success: false, message: error.message });
  }
};


// 3. Approve and Publish Social Post
exports.approveAndPublishPost = async (req, res) => {
  try {
    const { postId } = req.params;

    const updatedPost = await SocialPost.findByIdAndUpdate(
      postId,
      { status: 'Published', publishedAt: new Date() },
      { new: true }
    );

    if (!updatedPost) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    res.status(200).json({ 
      success: true, 
      message: "Post successfully approved and published!", 
      data: updatedPost 
    });
  } catch (error) {
    console.error("Error in approveAndPublishPost:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};