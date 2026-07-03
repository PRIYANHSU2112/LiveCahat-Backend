import mongoose from 'mongoose';
import { NOTIFICATION_TYPES, NOTIFICATION_STATUSES } from '../constants/enum.constant.js';

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // Null for system/promotional notifications
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: 'UNREAD',
      index: true,
    },
    // Metadata block to pass route keys/ids for the mobile app (Flutter/React Native navigation)
    metadata: {
      type: Map,
      of: String,
      default: {},
    },
    pushSent: {
      type: Boolean,
      default: false,
    },
    pushError: {
      type: String,
      default: null,
    },
    isMuted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes to speed up listing user notifications sorted by time
notificationSchema.index({ recipientId: 1, status: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
