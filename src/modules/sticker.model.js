import mongoose from 'mongoose';
import { STICKER_UNLOCK_TYPES } from '../constants/enum.constant.js';

const stickerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String, // URL of the sticker image (PNG/WEBP/GIF)
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StickerCategory',
      required: true,
      index: true,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    // How a user gains access to this sticker:
    //   FREE  → available to everyone
    //   PAID  → purchased with coins (uses `price`)
    //   LEVEL → auto-unlocked when user reaches `requiredLevel`
    unlockType: {
      type: String,
      enum: STICKER_UNLOCK_TYPES,
      default: 'FREE',
      required: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0, // Coin cost — only relevant when unlockType === 'PAID'
    },
    requiredLevel: {
      type: Number,
      default: 1,
      min: 1, // Minimum user level — only relevant when unlockType === 'LEVEL'
    },
    sortOrder: {
      type: Number,
      default: 0, // Lower values appear first within a category
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for fetching active stickers of a category in order
stickerSchema.index({ categoryId: 1, isActive: 1, sortOrder: 1 });
stickerSchema.index({ unlockType: 1 });

const Sticker = mongoose.model('Sticker', stickerSchema);
export default Sticker;
