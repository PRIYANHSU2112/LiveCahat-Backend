import mongoose from 'mongoose';
import { XP_ACTIONS } from '../constants/enum.constant.js';

const xpTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: XP_ACTIONS,
      required: true,
    },
    xpAwarded: {
      type: Number,
      required: true,
      min: 0,
    },
    xpBefore: {
      type: Number,
      required: true,
    },
    xpAfter: {
      type: Number,
      required: true,
    },
    levelBefore: {
      type: Number,
      required: true,
    },
    levelAfter: {
      type: Number,
      required: true,
    },
    metadata: {
      type: Map,
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

xpTransactionSchema.index({ userId: 1, createdAt: -1 });

const XpTransaction = mongoose.model('XpTransaction', xpTransactionSchema);
export default XpTransaction;
