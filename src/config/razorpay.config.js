import Razorpay from 'razorpay';
import crypto from 'crypto';

export const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'mock_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'mock_key_secret',
});

/**
 * Verify Razorpay Webhook Signature
 * @param {string} body - The raw request body
 * @param {string} signature - The razorpay-signature header
 * @param {string} secret - The webhook secret string configured in Razorpay Dashboard
 */
export const verifyWebhookSignature = (body, signature, secret) => {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return expectedSignature === signature;
};
