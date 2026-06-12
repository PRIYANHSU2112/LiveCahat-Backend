import mongoose from 'mongoose';
import { COMMUNICATION_SESSION_STATUSES } from '../constants/enum.constant.js';

const communicationSessionSchema = new mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    listenerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      default: null,
    },
    endTime: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number,
      default: 0, // Duration in seconds
    },
    status: {
      type: String,
      enum: COMMUNICATION_SESSION_STATUSES,
      default: 'INITIATED',
      index: true,
    },
    totalCoinsSpent: {
      type: Number,
      default: 0, // Total coins spent by the caller
      min: 0,
    },
    totalCoinsEarned: {
      type: Number,
      default: 0, // Total coins earned by the listener
      min: 0,
    },
    disconnectReason: {
      type: String,
      default: null, // e.g., 'CALLER_DISCONNECTED', 'LISTENER_DISCONNECTED', 'INSUFFICIENT_BALANCE', 'TIMEOUT'
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null, // Rating given by caller to listener
    },
    reviewComment: {
      type: String,
      trim: true,
      default: null, // Review comment given by caller
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fetching sessions sorted by time for caller or listener
communicationSessionSchema.index({ callerId: 1, createdAt: -1 });
communicationSessionSchema.index({ listenerId: 1, createdAt: -1 });

const CommunicationSession = mongoose.model('CommunicationSession', communicationSessionSchema);
export default CommunicationSession;
