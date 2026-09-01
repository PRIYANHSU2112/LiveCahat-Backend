import mongoose from 'mongoose';

const communicationConfigSchema = new mongoose.Schema(
  {
    maxSessionDurationMinutes: {
      type: Number,
      default: 60,
      min: 1,
      max: 480,
    },
    recordingEnabled: {
      type: Boolean,
      default: false,
    },
    messageRetentionDays: {
      type: Number,
      default: 90,
      min: 1,
      max: 3650,
    },
    mediaSharingEnabled: {
      type: Boolean,
      default: true,
    },
    hdVideoDefault: {
      type: Boolean,
      default: true,
    },
    noiseCancellationEnabled: {
      type: Boolean,
      default: true,
    },
    maxVideoParticipants: {
      type: Number,
      default: 2,
      min: 2,
      max: 10,
    },
    /** Master toggle for live room per-minute viewer billing. */
    liveBillingEnabled: {
      type: Boolean,
      default: true,
    },
    /** Fallback coins/minute rate if listener has not set liveRate. */
    defaultLiveRate: {
      type: Number,
      default: 10,
      min: 0,
    },
    /** Platform-wide default listener earning percentage (e.g. 70 = 70% to listener, 30% to platform). */
    defaultEarningPercent: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
  }
);

const CommunicationConfig = mongoose.model('CommunicationConfig', communicationConfigSchema);
export default CommunicationConfig;
