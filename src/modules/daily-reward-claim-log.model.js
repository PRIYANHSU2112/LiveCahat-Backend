import mongoose from 'mongoose';

const dailyRewardClaimLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    claimDate: {
      type: String, // format "YYYY-MM-DD"
      required: true,
    },
    dayClaimed: {
      type: Number,
      required: true,
      min: 1,
      max: 7,
    },
    rewardType: {
      type: String,
      enum: ['COINS', 'GIFT'],
      required: true,
    },
    rewardValue: {
      type: mongoose.Schema.Types.Mixed, // E.g., coin count (Number) or gift name (String)
      required: true,
    },
    claimedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index to prevent multiple claims on the same calendar day (UTC)
dailyRewardClaimLogSchema.index({ userId: 1, claimDate: 1 }, { unique: true });

const DailyRewardClaimLog = mongoose.model('DailyRewardClaimLog', dailyRewardClaimLogSchema);
export default DailyRewardClaimLog;
