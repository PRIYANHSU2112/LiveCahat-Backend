import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunicationSession',
      required: false,
      default: null,
      index: true,
    },
    clientMsgId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
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
    deliveryStatus: {
      type: String,
      enum: ['SENT', 'DELIVERED', 'READ'],
      default: 'SENT',
      index: true,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
chatMessageSchema.index({ sessionId: 1, createdAt: 1 });
chatMessageSchema.index({ sessionId: 1, createdAt: -1 });
chatMessageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
chatMessageSchema.index({ recipientId: 1, deliveryStatus: 1 });
chatMessageSchema.index({ sessionId: 1, senderId: 1, readAt: 1 });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
export default ChatMessage;
