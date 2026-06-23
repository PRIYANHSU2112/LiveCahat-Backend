import mongoose from 'mongoose';
import { WITHDRAWAL_STATUSES } from '../constants/enum.constant.js';

const withdrawalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: true,
    },
    // Frozen copy of the destination at request time (masked account etc.)
    bankAccountSnapshot: {
      type: mongoose.Schema.Types.Mixed,
    },
    coinsRequested: {
      type: Number,
      required: true,
      min: 1,
    },
    // Rate + breakdown snapshot (so later config/rate changes don't rewrite history)
    conversionCoins: {
      type: Number,
      required: true,
    },
    conversionInr: {
      type: Number,
      required: true,
    },
    grossInr: {
      type: Number,
      required: true,
    },
    feePercentage: {
      type: Number,
      default: 0,
    },
    feeInr: {
      type: Number,
      default: 0,
    },
    netInr: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: WITHDRAWAL_STATUSES,
      default: 'PENDING',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1 });

const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
export default Withdrawal;
