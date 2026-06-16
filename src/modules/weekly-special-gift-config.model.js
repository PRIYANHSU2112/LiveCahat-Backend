import mongoose from 'mongoose';

const weeklySpecialGiftConfigSchema = new mongoose.Schema(
  {
    week: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      max: 4,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Gift',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const WeeklySpecialGiftConfig = mongoose.model('WeeklySpecialGiftConfig', weeklySpecialGiftConfigSchema);
export default WeeklySpecialGiftConfig;
