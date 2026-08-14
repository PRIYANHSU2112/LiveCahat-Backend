import Razorpay from 'razorpay';
import ApiError from '../utils/ApiError.js';
import settingsRuntime from './settings-runtime.service.js';

/**
 * Extensible provider adapters. Razorpay is implemented; others reject until added.
 */

let lastRazorpayKeyId = null;

function envRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret || key_id.startsWith('mock_')) {
    return null;
  }
  return {
    keyId: key_id,
    client: new Razorpay({ key_id, key_secret }),
  };
}

const adapters = {
  RAZORPAY: {
    async createOrder(options) {
      let primaryError = null;

      try {
        const client = await settingsRuntime.getRazorpayClient();
        const order = await client.orders.create(options);
        lastRazorpayKeyId = settingsRuntime.getRazorpayPublicKey();
        return order;
      } catch (err) {
        primaryError = err;
      }

      // DB gateway secrets can go stale — retry once with server .env keys
      const envClient = envRazorpayClient();
      if (envClient) {
        try {
          const order = await envClient.client.orders.create(options);
          lastRazorpayKeyId = envClient.keyId;
          return order;
        } catch (envErr) {
          primaryError = envErr;
        }
      }

      const description =
        primaryError?.error?.description ||
        primaryError?.description ||
        primaryError?.message ||
        'Unable to create payment order with Razorpay';
      throw new ApiError(502, description);
    },
    getPublicKey() {
      return lastRazorpayKeyId || settingsRuntime.getRazorpayPublicKey();
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
