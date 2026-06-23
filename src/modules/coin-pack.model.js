import mongoose from 'mongoose';

const coinPackSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    coins: {
      type: Number,
      min: 1,
    },
    price: {
      type: Number,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    ratePerCoin: {
      type: Number,
      // For reference: price / coins
    },
    referralBonusCoins: {
      type: Number,
      default: 0,
      min: 0, // Free coins BOTH referrer and referred friend get on the friend's first purchase of this pack
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    badge: {
      type: String, // e.g., 'Best Value', 'Most Popular'
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    }
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to calculate rate per coin automatically
coinPackSchema.pre('save', function (next) {
  if (this.coins && this.price) {
    this.ratePerCoin = Number((this.price / this.coins).toFixed(2));
  }
  next();
});

const CoinPack = mongoose.model('CoinPack', coinPackSchema);
export default CoinPack;
