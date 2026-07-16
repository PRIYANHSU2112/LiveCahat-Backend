import ApiError from '../utils/ApiError.js';
import settingsRuntime from './settings-runtime.service.js';

/**
 * Extensible provider adapters. Razorpay is implemented; others reject until added.
 */
const adapters = {
  RAZORPAY: {
    async createOrder(options) {
      const client = await settingsRuntime.getRazorpayClient();
      return client.orders.create(options);
    },
    getPublicKey() {
      return settingsRuntime.getRazorpayPublicKey();
    },
    getWebhookSecret() {
      return settingsRuntime.getRazorpayWebhookSecret();
    },
  },
};

export function getPaymentAdapter(provider = 'RAZORPAY') {
  const key = String(provider || 'RAZORPAY').toUpperCase();
  const adapter = adapters[key];
  if (!adapter) {
    throw new ApiError(
      501,
      `Payment provider ${key} is configured but checkout adapter is not implemented yet.`
    );
  }
  return adapter;
}

export default adapters;
