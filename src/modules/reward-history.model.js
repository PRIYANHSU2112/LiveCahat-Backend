import mongoose from 'mongoose';
import { LEVEL_REWARD_TYPES, REWARD_CLAIM_STATUSES } from '../constants/enum.constant.js';

const rewardHistorySchema = new mongoose.Schema(
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
    rewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reward',
      default: null,
    },
    rewardType: {
      type: String,
      enum: LEVEL_REWARD_TYPES,
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Snapshot of the reward at the moment it was earned (protects user
    // if admin later edits or deletes the source Reward).
    value: {
      type: Number,
      default: 0,
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
    description: {
      type: String,
      trim: true,
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

rewardHistorySchema.index({ userId: 1, createdAt: -1 });
rewardHistorySchema.index({ userId: 1, status: 1 });

const RewardHistory = mongoose.model('RewardHistory', rewardHistorySchema);
export default RewardHistory;
