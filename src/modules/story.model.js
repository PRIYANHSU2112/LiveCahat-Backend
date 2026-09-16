import mongoose from 'mongoose';

const storyMetadataSchema = new mongoose.Schema(
  {
    width: {
      type: Number,
      min: 0,
      max: 4096,
      default: null,
    },
    height: {
      type: Number,
      min: 0,
      max: 4096,
      default: null,
    },
    duration: {
      type: Number,
      min: 0,
      max: 300,
      default: 0,
    },
    backgroundColor: {
      type: String,
      maxlength: 30,
      trim: true,
      default: null,
    },
    textColor: {
      type: String,
      maxlength: 30,
      trim: true,
      default: null,
    },
    fontFamily: {
      type: String,
      maxlength: 50,
      trim: true,
      default: null,
    },
  },
  { _id: false }
);

const storySchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['IMAGE', 'VIDEO', 'TEXT', 'LIVE'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'DELETED', 'ENDED'],
      default: 'ACTIVE',
      index: true,
    },
    fileKey: {
      type: String,
      default: null,
      trim: true,
    },
    mediaUrl: {
      type: String,
      default: null,
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      default: null,
      trim: true,
    },
    caption: {
      type: String,
      maxlength: 500,
      trim: true,
      default: '',
    },
    text: {
      type: String,
      maxlength: 1000,
      trim: true,
      default: '',
    },
    metadata: {
      type: storyMetadataSchema,
      default: () => ({}),
    },
    visibility: {
      type: String,
      enum: ['PUBLIC', 'FOLLOWERS'],
      default: 'PUBLIC',
      index: true,
    },
    liveSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LiveRoom',
      default: null,
      index: true,
    },
    viewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// High-performance compound indexes
storySchema.index({ status: 1, expiresAt: 1, createdAt: -1 });
storySchema.index({ ownerId: 1, status: 1, expiresAt: 1, createdAt: -1 });
storySchema.index({ liveSessionId: 1, status: 1 }, { sparse: true });
storySchema.index({ ownerId: 1, type: 1, status: 1 });

const Story = mongoose.model('Story', storySchema);
export default Story;
