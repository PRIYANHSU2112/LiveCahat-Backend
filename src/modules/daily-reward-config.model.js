import mongoose from 'mongoose';

const dailyRewardConfigSchema = new mongoose.Schema(
  {
    day: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      max: 7,
    },
    rewardType: {
      type: String,
      enum: ['COINS', 'GIFT', 'WEEKLY_SPECIAL_GIFT'],
      required: true,
    },
    rewardValue: {
      type: Number,
      default: 0,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Gift',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const DailyRewardConfig = mongoose.model('DailyRewardConfig', dailyRewardConfigSchema);
export default DailyRewardConfig;
