import mongoose from 'mongoose';
import { ANCHOR_REWARD_TYPES, REWARD_CLAIM_STATUSES } from '../constants/enum.constant.js';

const anchorRewardClaimSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    level: {
      type: Number,
      required: true,
    },
    rewardType: {
      type: String,
      enum: ANCHOR_REWARD_TYPES,
      required: true,
    },
    // Snapshot of the reward at the moment it was earned (protects the listener
    // if the admin later edits or deletes the level/reward).
    value: {
      type: Number,
      default: 0,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Gift',
      default: null,
    },
    label: {
      type: String,
      trim: true,
    },
    icon: {
      type: String,
      trim: true,
    },
    coinsGranted: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: REWARD_CLAIM_STATUSES,
      default: 'UNCLAIMED',
    },
    claimedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

anchorRewardClaimSchema.index({ userId: 1, status: 1 });
anchorRewardClaimSchema.index({ userId: 1, createdAt: -1 });

const AnchorRewardClaim = mongoose.model('AnchorRewardClaim', anchorRewardClaimSchema);
export default AnchorRewardClaim;
