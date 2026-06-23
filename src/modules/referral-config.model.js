import mongoose from 'mongoose';

// Singleton settings document controlling referral rewards (admin-managed).
const referralConfigSchema = new mongoose.Schema(
  {
    referrerRewardCoins: {
      type: Number,
      default: 50,
      min: 0, // Coins awarded to the referrer
    },
    referredRewardCoins: {
      type: Number,
      default: 50,
      min: 0, // Coins awarded to the referred friend
    },
    inviteLinkPrefix: {
      type: String,
      default: 'https://cornerchat.com/invite?code=',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const ReferralConfig = mongoose.model('ReferralConfig', referralConfigSchema);
export default ReferralConfig;
