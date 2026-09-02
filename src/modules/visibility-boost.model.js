import mongoose from 'mongoose';
import { VISIBILITY_BOOST_STATUSES } from '../constants/enum.constant.js';

const visibilityBoostSchema = new mongoose.Schema(
  {
    listenerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: VISIBILITY_BOOST_STATUSES,
      default: 'ACTIVE',
      required: true,
    },
    amountCoins: {
      type: Number,
      required: true,
      min: 1,
    },
    sequence: {
      type: Number,
      required: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CoinTransaction',
      default: null,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 64,
    },
  },
  {
    timestamps: true,
    collection: 'visibility_boosts',
  }
);

// Expiry sweeps & active slot counting
visibilityBoostSchema.index({ status: 1, expiresAt: 1 });
// Duplicate prevention & listener's active boost lookup
visibilityBoostSchema.index({ listenerId: 1, status: 1 });
// Home API boost ordering — active boosts sorted by sequence
visibilityBoostSchema.index({ status: 1, sequence: 1 });
// Idempotent retries — unique per non-null key
visibilityBoostSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

const VisibilityBoost = mongoose.model('VisibilityBoost', visibilityBoostSchema);
export default VisibilityBoost;
