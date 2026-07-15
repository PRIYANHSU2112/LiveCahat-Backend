import mongoose from 'mongoose';
import { XP_ACTIONS } from '../constants/enum.constant.js';

const xpConfigSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: XP_ACTIONS,
      required: true,
      unique: true,
    },
    xp: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    label: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// `action` uniqueness comes from field-level `unique: true` — do not redeclare here

const XpConfig = mongoose.model('XpConfig', xpConfigSchema);
export default XpConfig;
