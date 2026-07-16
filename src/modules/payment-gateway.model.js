import mongoose from 'mongoose';
import { PAYMENT_GATEWAY_PROVIDERS, PAYMENT_GATEWAY_MODES } from '../constants/settings.constant.js';

const encryptedBlobSchema = new mongoose.Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
  },
  { _id: false }
);

const paymentGatewaySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: PAYMENT_GATEWAY_PROVIDERS,
      required: true,
      uppercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80,
    },
    mode: {
      type: String,
      enum: PAYMENT_GATEWAY_MODES,
      default: 'sandbox',
    },
    isEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    publicKey: {
      type: String,
      trim: true,
      default: '',
    },
    merchantId: {
      type: String,
      trim: true,
      default: '',
    },
    secretEncrypted: {
      type: encryptedBlobSchema,
      default: null,
    },
    webhookSecretEncrypted: {
      type: encryptedBlobSchema,
      default: null,
    },
    secretLast4: {
      type: String,
      default: null,
    },
    webhookSecretLast4: {
      type: String,
      default: null,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

paymentGatewaySchema.index(
  { provider: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
paymentGatewaySchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true, isDeleted: false } }
);

const PaymentGateway = mongoose.model('PaymentGateway', paymentGatewaySchema);
export default PaymentGateway;
