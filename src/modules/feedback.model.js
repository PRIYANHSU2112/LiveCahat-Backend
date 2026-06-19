import mongoose from 'mongoose';
import { USER_TYPES, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '../constants/enum.constant.js';

const feedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userType: {
      type: String,
      enum: USER_TYPES, // snapshot of submitter's role at submit time
      required: true,
    },
    category: {
      type: String,
      enum: FEEDBACK_CATEGORIES,
      default: 'OTHER',
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    // ── Admin-managed moderation fields ──
    status: {
      type: String,
      enum: FEEDBACK_STATUSES,
      default: 'OPEN',
    },
    adminResponse: {
      type: String,
      trim: true,
      default: null,
    },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

feedbackSchema.index({ userId: 1, createdAt: -1 });
feedbackSchema.index({ status: 1 });
feedbackSchema.index({ category: 1 });

const Feedback = mongoose.model('Feedback', feedbackSchema);
export default Feedback;
