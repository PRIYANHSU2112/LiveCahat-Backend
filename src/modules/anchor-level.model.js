import mongoose from 'mongoose';
import { ANCHOR_REQUIREMENT_TYPES, ANCHOR_REWARD_TYPES } from '../constants/enum.constant.js';

// Embedded reward configured inline per anchor level by the admin.
const anchorRewardSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ANCHOR_REWARD_TYPES,
      required: true,
    },
    value: {
      type: Number,
      default: 1,
      min: 0, // coin amount (COINS) or quantity (GIFT/ITEM)
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Gift',
      default: null, // points to a Gift for GIFT rewards
    },
    label: {
      type: String,
      trim: true,
    },
    icon: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const anchorLevelSchema = new mongoose.Schema(
  {
    level: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    requirementType: {
      type: String,
      enum: ANCHOR_REQUIREMENT_TYPES,
      default: 'EARNINGS',
    },
    requiredEarnings: {
      type: Number,
      default: 0,
      min: 0, // lifetime coins the listener must earn — used when requirementType === 'EARNINGS'
    },
    badge: {
      type: String,
      trim: true,
    },
    rewards: {
      type: [anchorRewardSchema],
      default: [],
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

anchorLevelSchema.index({ isActive: 1 });

const AnchorLevel = mongoose.model('AnchorLevel', anchorLevelSchema);
export default AnchorLevel;
