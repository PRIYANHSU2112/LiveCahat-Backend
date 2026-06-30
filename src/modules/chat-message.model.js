import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunicationSession',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ['TEXT', 'SYSTEM', 'IMAGE', 'VIDEO', 'AUDIO'],
      default: 'TEXT',
    },
    fileUrl: {
      type: String,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fetching messages by session in chronological order
chatMessageSchema.index({ sessionId: 1, createdAt: 1 });
// Latest message per session + unread counts
chatMessageSchema.index({ sessionId: 1, createdAt: -1 });
chatMessageSchema.index({ sessionId: 1, senderId: 1, readAt: 1 });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
export default ChatMessage;
