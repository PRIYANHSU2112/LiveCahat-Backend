import mongoose from 'mongoose';
import { SESSION_MODES } from '../constants/enum.constant.js';

const sessionSegmentSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunicationSession',
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: SESSION_MODES,
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number,
      default: 0, // Duration in seconds
    },
    ratePerMinute: {
      type: Number,
      required: true, // Cost in coins per minute at the time of the segment
      min: 0,
    },
    coinsCharged: {
      type: Number,
      default: 0, // Total coins charged for this segment
      min: 0,
    },
    status: {
      type: String,
      enum: ['ONGOING', 'COMPLETED', 'FAILED'],
      default: 'ONGOING',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
sessionSegmentSchema.index({ sessionId: 1, startTime: 1 });

const SessionSegment = mongoose.model('SessionSegment', sessionSegmentSchema);
export default SessionSegment;
