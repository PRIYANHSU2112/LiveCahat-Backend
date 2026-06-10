import mongoose from 'mongoose';
import { PAYMENT_GATEWAYS, PAYMENT_STATUSES } from '../constants/enum.constant.js';

const paymentTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    coinPackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CoinPack',
      // Useful if the payment was specifically to buy a coin pack
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    paymentGateway: {
      type: String,
      enum: PAYMENT_GATEWAYS,
      default: 'RAZORPAY',
    },
    OrderId: {
      type: String,
      // e.g., Razorpay Order ID (order_Ilu....)
    },
    gatewayTransactionId: {
      type: String,
      // e.g., Razorpay Payment ID (pay_Ilu....)
    },
    gatewaySignature: {
      type: String,
    },
    status: {
      type: String,
      enum:PAYMENT_STATUSES,
      default: 'PENDING',
      index: true,
    },
    failureReason: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      // Store any extra JSON data from webhook or gateway response
    }
  },
  {
    timestamps: true,
  }
);

const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);
export default PaymentTransaction;
