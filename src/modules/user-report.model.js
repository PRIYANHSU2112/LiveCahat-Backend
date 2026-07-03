import mongoose from 'mongoose';
import { REPORT_STATUSES } from '../constants/enum.constant.js';

const userReportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reporterType: {
      type: String,
      enum: ['CUSTOMER', 'LISTENER'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['CUSTOMER', 'LISTENER'],
      required: true,
    },
    reasonIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'ReportReason',
          required: true,
        },
      ],
      required: true,
      validate: {
        validator: (ids) => Array.isArray(ids) && ids.length > 0,
        message: 'At least one reason is required',
      },
    },
    reasonLabels: {
      type: [String],
      required: true,
      validate: {
        validator: (labels) => Array.isArray(labels) && labels.length > 0,
        message: 'At least one reason is required',
      },
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1000,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunicationSession',
      default: null,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: 'OPEN',
      index: true,
    },
    adminNote: {
      type: String,
      trim: true,
      default: null,
      maxlength: 1000,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userReportSchema.index({ status: 1, createdAt: -1 });
userReportSchema.index({ agentId: 1, createdAt: -1 });
userReportSchema.index({ reporterId: 1, targetId: 1, status: 1 });
userReportSchema.index({ reasonIds: 1 });

const UserReport = mongoose.model('UserReport', userReportSchema);
export default UserReport;
