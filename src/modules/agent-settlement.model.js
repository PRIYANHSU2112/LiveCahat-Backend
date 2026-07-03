import mongoose from 'mongoose';
import { SETTLEMENT_STATUSES } from '../constants/enum.constant.js';

const agentSettlementSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    settlementCode: {
      type: String,
      required: true,
      trim: true,
    },
    cycleLabel: {
      type: String,
      required: true,
      trim: true,
    },
    cycleStart: {
      type: Date,
      required: true,
    },
    cycleEnd: {
      type: Date,
      required: true,
    },
    listenerEarningsTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    amountCoins: {
      type: Number,
      required: true,
      min: 0,
    },
    amountInr: {
      type: Number,
      default: 0,
      min: 0,
    },
    listenerCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: SETTLEMENT_STATUSES,
      default: 'PENDING',
      index: true,
    },
    coinTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CoinTransaction',
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true }
);

agentSettlementSchema.index({ agentId: 1, cycleLabel: 1 }, { unique: true });
agentSettlementSchema.index({ agentId: 1, createdAt: -1 });
agentSettlementSchema.index({ status: 1, cycleEnd: -1 });

const AgentSettlement = mongoose.model('AgentSettlement', agentSettlementSchema);
export default AgentSettlement;
