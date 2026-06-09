import mongoose from 'mongoose';
import { COIN_TRANSACTION_TYPES, COIN_REFERENCE_TYPES } from '../constants/enum.constant.js';

const coinTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: COIN_TRANSACTION_TYPES,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    balanceAfter: {
      type: Number,
      // Helps in maintaining ledger and audit trail without recounting everything
    },
    referenceType: {
      type: String,
      enum: COIN_REFERENCE_TYPES,
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      // Points to PaymentTransaction _id, Call _id, Chat _id etc.
      index: true,
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

// Add compound index for efficient querying of user's transactions
coinTransactionSchema.index({ userId: 1, createdAt: -1 });

const CoinTransaction = mongoose.model('CoinTransaction', coinTransactionSchema);
export default CoinTransaction;
