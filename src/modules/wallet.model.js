import mongoose from 'mongoose';
import { WALLET_STATUSES } from '../constants/enum.constant.js';

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    coinBalance: {
      type: Number,
      default: 0,
    },
    totalRecharge: {
      type: Number,
      default: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
    totalEarned: {
      type: Number,
      default: 0,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: WALLET_STATUSES,
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

walletSchema.index({ status: 1 });

const Wallet = mongoose.model('Wallet', walletSchema);
export default Wallet;
