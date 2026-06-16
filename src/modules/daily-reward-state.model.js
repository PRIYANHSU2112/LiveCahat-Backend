import mongoose from 'mongoose';

const dailyRewardStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    lastClaimedAt: {
      type: Date,
      default: null,
    },
    lastClaimedDay: {
      type: Number,
      default: 0,
      min: 0,
      max: 7,
    },
    specialGiftWeek: {
      type: Number,
      default: 1,
      min: 1,
      max: 4,
    },
  },
  {
    timestamps: true,
  }
);

const DailyRewardState = mongoose.model('DailyRewardState', dailyRewardStateSchema);
export default DailyRewardState;
