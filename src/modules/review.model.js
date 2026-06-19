import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    listenerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    reviewComment: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// One review per user per listener
reviewSchema.index({ userId: 1, listenerId: 1 }, { unique: true });
// Fetch a listener's reviews newest-first
reviewSchema.index({ listenerId: 1, createdAt: -1 });

const Review = mongoose.model('Review', reviewSchema);
export default Review;
