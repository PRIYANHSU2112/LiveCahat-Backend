import mongoose from 'mongoose';
import { TRANSACTION_TYPES, TRANSACTION_REFERENCE_TYPES, TRANSACTION_STATUSES } from '../constants/enum.constant.js';

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    type: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    referenceType: {
      type: String,
      enum: TRANSACTION_REFERENCE_TYPES,
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      required: true,
      default: 'PENDING',
    },
    remarks: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ userId: 1 });
walletTransactionSchema.index({ walletId: 1 });
walletTransactionSchema.index({ type: 1 });
walletTransactionSchema.index({ status: 1 });

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);
export default WalletTransaction;
