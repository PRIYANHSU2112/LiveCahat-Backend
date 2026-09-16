import mongoose from 'mongoose';

const storyViewSchema = new mongoose.Schema(
  {
    storyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Story',
      required: true,
      index: true,
    },
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    storyOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index: prevents duplicate views per user per story
storyViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });
storyViewSchema.index({ viewerId: 1, storyOwnerId: 1, storyId: 1 });
storyViewSchema.index({ storyOwnerId: 1, createdAt: -1 });

const StoryView = mongoose.model('StoryView', storyViewSchema);
export default StoryView;
