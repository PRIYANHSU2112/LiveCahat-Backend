import mongoose from 'mongoose';

const giftTransactionSchema = new mongoose.Schema(
  {
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Gift',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // The sender (can be a CUSTOMER/User or an ADMIN)
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // The receiver (can be a LISTENER or a CUSTOMER/User)
      index: true,
    },
    coins: {
      type: Number,
      required: true, // Price of the gift in coins at transaction time
      min: 0,
    },
    earningPercent: {
      type: Number,
      required: true, // Earning percentage snapshot at transaction time
      min: 0,
      max: 100,
    },
    adminPercent: {
      type: Number,
      required: true, // Admin percentage snapshot at transaction time
      min: 0,
      max: 100,
    },
    earningCoins: {
      type: Number,
      required: true, // Coins credited to receiver (or equivalent value)
      min: 0,
    },
    adminCoins: {
      type: Number,
      required: true, // Coins kept by admin/platform commission
      min: 0,
    },
    type: {
      type: String,
      enum: ['USER_TO_LISTENER', 'ADMIN_TO_USER', 'ADMIN_TO_LISTENER'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: 'SUCCESS',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast transaction queries by sender/receiver
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });
giftTransactionSchema.index({ receiverId: 1, createdAt: -1 });
giftTransactionSchema.index({ receiverId: 1, status: 1, createdAt: -1 });

const GiftTransaction = mongoose.model('GiftTransaction', giftTransactionSchema);
export default GiftTransaction;
