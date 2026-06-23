import mongoose from 'mongoose';
import { PAYMENT_METHOD_TYPES } from '../constants/enum.constant.js';

const bankAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    methodType: {
      type: String,
      enum: PAYMENT_METHOD_TYPES,
      required: true,
    },
    // ── BANK fields ──
    bankName: {
      type: String,
      trim: true,
    },
    accountHolderName: {
      type: String,
      trim: true,
    },
    accountNumber: {
      type: String,
      trim: true,
    },
    ifscCode: {
      type: String,
      trim: true,
      uppercase: true,
    },
    // ── UPI fields ──
    upiId: {
      type: String,
      trim: true,
    },
    payeeName: {
      type: String,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

bankAccountSchema.index({ userId: 1, createdAt: -1 });

const BankAccount = mongoose.model('BankAccount', bankAccountSchema);
export default BankAccount;
