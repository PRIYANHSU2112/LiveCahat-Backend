import mongoose from 'mongoose';

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // One wishlist document per user
    },
    // Note: `listeners` is a reserved mongoose path name; suppressed below.
    listeners: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  }
);

// userId unique index already created by field-level `unique: true`
wishlistSchema.index({ userId: 1, listeners: 1 }); // Covering index for membership checks

const Wishlist = mongoose.model('Wishlist', wishlistSchema);
export default Wishlist;
