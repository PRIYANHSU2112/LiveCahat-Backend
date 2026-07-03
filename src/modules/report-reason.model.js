import mongoose from 'mongoose';

const reportReasonSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

reportReasonSchema.index({ isActive: 1, sortOrder: 1 });

const ReportReason = mongoose.model('ReportReason', reportReasonSchema);
export default ReportReason;
