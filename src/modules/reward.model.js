import mongoose from 'mongoose';
import { LEVEL_REWARD_TYPES } from '../constants/enum.constant.js';

const rewardSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: LEVEL_REWARD_TYPES,
      required: true,
    },
    value: {
      type: Number,
      default: 1,
      min: 0,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      // Polymorphic ref → Avatar._id / Gift._id depending on type
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      trim: true,
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

rewardSchema.index({ type: 1 });
rewardSchema.index({ isActive: 1 });

const Reward = mongoose.model('Reward', rewardSchema);
export default Reward;
