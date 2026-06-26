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
    // Mirrors the owning user's country so listeners can be filtered by country
    // without an extra join. Kept in sync when the listener profile is created/updated.
    country: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Country',
      default: null,
    },
    categories: [
      {
        type: String,
        enum: LISTENER_CATEGORIES,
      },
    ],
    interests: [
      {
        type: String,
        trim: true,
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
    // Timestamp of when KYC was most recently approved (null until first approval).
    // Powers the agent panel "today approved" / month-over-month approved trend cards.
    kycApprovedAt: {
      type: Date,
      default: null,
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
    anchorLevel: {
      type: Number,
      default: 0,
      min: 0, // 0 = no anchor level reached yet
    },
    createdByAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    profileStatus: {
      type: String,
      enum: ['incomplete', 'completed'],
      default: 'completed',
    },
    magicLoginToken: {
      type: String,
      unique: true,
      sparse: true,
    },
    // Denormalized count of gifts received — powers the agent panel "Gifts" column
    // without scanning gift transactions per row. Maintained in gift.service.js.
    giftsReceivedCount: {
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
// Home-feed: APPROVED listeners are filtered by status and sorted by popularity/rating.
listenerProfileSchema.index({ kycStatus: 1, availability: 1 });
listenerProfileSchema.index({ kycStatus: 1, isFeatured: -1, followersCount: -1 });
listenerProfileSchema.index({ kycStatus: 1, avgRating: -1 });
listenerProfileSchema.index({ kycStatus: 1, languages: 1 });
listenerProfileSchema.index({ kycStatus: 1, country: 1 });
// Agent panel: list + stat cards are always scoped to the owning agent.
listenerProfileSchema.index({ createdByAgentId: 1 });
listenerProfileSchema.index({ createdByAgentId: 1, kycStatus: 1 });
listenerProfileSchema.index({ createdByAgentId: 1, availability: 1 });
// Agent panel stat cards: approved totals + "today approved" are filtered by approval date.
listenerProfileSchema.index({ createdByAgentId: 1, kycApprovedAt: 1 });

const ListenerProfile = mongoose.model('ListenerProfile', listenerProfileSchema);
export default ListenerProfile;
