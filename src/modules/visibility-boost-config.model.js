import mongoose from 'mongoose';

/**
 * Singleton admin-managed configuration for Visibility Boost pricing,
 * duration, slot limits, and feature toggle.
 */
const visibilityBoostConfigSchema = new mongoose.Schema(
  {
    isEnabled: {
      type: Boolean,
      default: true,
    },
    priceCoins: {
      type: Number,
      default: 500,
      min: 1,
    },
    durationMinutes: {
      type: Number,
      default: 60,
      min: 1,
      max: 1440, // max 24 hours
    },
    maxActiveSlots: {
      type: Number,
      default: 20,
      min: 1,
      max: 100,
    },
  },
  {
    timestamps: true,
    collection: 'visibility_boost_configs',
  }
);

const VisibilityBoostConfig = mongoose.model('VisibilityBoostConfig', visibilityBoostConfigSchema);
export default VisibilityBoostConfig;
