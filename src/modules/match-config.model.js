import mongoose from 'mongoose';

// Singleton settings document controlling instant-match fees (admin-managed).
const matchConfigSchema = new mongoose.Schema(
  {
    instantMatchFee: {
      type: Number,
      default: 5,
      min: 0,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const MatchConfig = mongoose.model('MatchConfig', matchConfigSchema);
export default MatchConfig;
