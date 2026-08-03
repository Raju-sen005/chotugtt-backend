const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  authorName: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  sentiment: { type: String, enum: ['Positive', 'Neutral', 'Negative'], default: 'Neutral' },
  category: { type: String, default: 'General' },
  severity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Low' },
  aiReply: { type: String },
  replyStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Posted'], default: 'Pending' },
  isComplaint: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);