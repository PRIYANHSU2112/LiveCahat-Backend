import mongoose from 'mongoose';

// Singleton settings document controlling coin→INR withdrawals (admin-managed).
const withdrawalConfigSchema = new mongoose.Schema(
  {
    conversionCoins: {
      type: Number,
      default: 1000,
      min: 1, // "1000 coins ="
    },
    conversionInr: {
      type: Number,
      default: 100,
      min: 0, // "= 100 INR"  → rate = conversionInr / conversionCoins
    },
    feePercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    minWithdrawalCoins: {
      type: Number,
      default: 1000,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

const WithdrawalConfig = mongoose.model('WithdrawalConfig', withdrawalConfigSchema);
export default WithdrawalConfig;
