import mongoose from 'mongoose';
import { LIVE_ROOM_STATUSES, LIVE_ROOM_MODES } from '../constants/enum.constant.js';

const liveRoomSchema = new mongoose.Schema(
  {
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    channelName: {
      type: String,
      required: true,
      unique: true,
    },
    title: {
      type: String,
      maxlength: 100,
      default: '',
    },
    mode: {
      type: String,
      enum: LIVE_ROOM_MODES,
      required: true,
    },
    status: {
      type: String,
      enum: LIVE_ROOM_STATUSES,
      default: 'live',
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
    endReason: {
      type: String,
      default: null,
    },
    viewerCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Coins charged per minute to each viewer — snapshot at room creation. */
    liveRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Host earning percentage snapshot (e.g. 70 = host gets 70%). */
    earningPercent: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
    /** Aggregate total coins collected from all viewers during this live. */
    totalCoinsCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Aggregate host earnings (totalCoinsCollected × earningPercent). */
    totalCoinsEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

liveRoomSchema.index({ status: 1, startedAt: -1 });

const LiveRoom = mongoose.model('LiveRoom', liveRoomSchema);
export default LiveRoom;
