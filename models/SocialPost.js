const mongoose = require('mongoose');

const socialPostSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  platform: { type: String, enum: ['Instagram', 'Facebook', 'X', 'LinkedIn'], default: 'Instagram' },
  contentType: { type: String, required: true }, // e.g., Festival, Weekend Offer, New Dish
  caption: { type: String, required: true },
  hashtags: [String],
  imagePrompt: { type: String },
  imageUrl: { type: String },
  status: { type: String, enum: ['Draft', 'Approved', 'Published'], default: 'Draft' },
  scheduledFor: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('SocialPost', socialPostSchema);