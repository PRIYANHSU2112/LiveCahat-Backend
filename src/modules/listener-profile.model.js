import mongoose from 'mongoose';
import { LISTENER_CATEGORIES, KYC_STATUSES, AVAILABILITY_STATUSES } from '../constants/enum.constant.js';

const listenerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    bio: {
      type: String,
      trim: true,
    },
    profilePhotos: [
      {
        type: String,
      },
    ],
    introVideo: {
      type: String,
    },
    languages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Language',
      },
    ],
    categories: [
      {
        type: String,
        enum: LISTENER_CATEGORIES,
      },
    ],
    chatRate: {
      type: Number,
      default: 0,
    },
    voiceRate: {
      type: Number,
      default: 0,
    },
    videoRate: {
      type: Number,
      default: 0,
    },
    avgRating: {
      type: Number,
      default: 0,
    },
    totalRatings: {
      type: Number,
      default: 0,
    },
    totalSessions: {
      type: Number,
      default: 0,
    },
    kycStatus: {
      type: String,
      enum: KYC_STATUSES,
      default: 'PENDING',
    },
    documentType: {
      type: String,
    },
    documentFront: {
      type: String,
    },
    documentBack: {
      type: String,
    },
    selfieImage: {
      type: String,
    },
    rejectionReason: {
      type: String,
    },
    availability: {
      type: String,
      enum: AVAILABILITY_STATUSES,
      default: 'OFFLINE',
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    availableBalance: {
      type: Number,
      default: 0,
    },
    withdrawnAmount: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    featuredUntil: {
      type: Date,
    },
    followersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

listenerProfileSchema.index({ kycStatus: 1 });
listenerProfileSchema.index({ availability: 1 });
listenerProfileSchema.index({ isFeatured: 1 });

const ListenerProfile = mongoose.model('ListenerProfile', listenerProfileSchema);
export default ListenerProfile;
