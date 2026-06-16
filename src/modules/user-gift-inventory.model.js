import mongoose from 'mongoose';

const userGiftInventorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Gift',
      required: true,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ['UNOPENED', 'OPENED', 'UNUSED', 'USED'],
      default: 'UNOPENED',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
userGiftInventorySchema.index({ status: 1 });

const UserGiftInventory = mongoose.model('UserGiftInventory', userGiftInventorySchema);
export default UserGiftInventory;
