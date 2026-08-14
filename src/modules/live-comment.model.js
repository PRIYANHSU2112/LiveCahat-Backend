import mongoose from 'mongoose';

const liveCommentSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LiveRoom',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
      default: 'User',
    },
    userImage: {
      type: String,
      default: null,
    },
    text: {
      type: String,
      required: true,
      maxlength: 200,
      trim: true,
    },
    isHost: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

liveCommentSchema.index({ roomId: 1, createdAt: -1 });

const LiveComment = mongoose.model('LiveComment', liveCommentSchema);
export default LiveComment;
