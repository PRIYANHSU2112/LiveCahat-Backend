import mongoose from 'mongoose';

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // One wishlist document per user
    },
    listeners: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes
wishlistSchema.index({ userId: 1 });
wishlistSchema.index({ userId: 1, listeners: 1 }); // Covering index for membership checks

const Wishlist = mongoose.model('Wishlist', wishlistSchema);
export default Wishlist;
