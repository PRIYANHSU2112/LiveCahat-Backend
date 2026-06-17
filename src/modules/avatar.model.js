import mongoose from 'mongoose';
import { AVATAR_CATEGORIES, PRICE_TYPES } from '../constants/enum.constant.js';

const avatarSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    priceType: {
      type: String,
      enum: PRICE_TYPES,
      default: PRICE_TYPES[0],
      required: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      enum: AVATAR_CATEGORIES,
      default: AVATAR_CATEGORIES[0],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for active/pricing lookups
avatarSchema.index({ isActive: 1, priceType: 1 });

const Avatar = mongoose.model('Avatar', avatarSchema);
export default Avatar;
