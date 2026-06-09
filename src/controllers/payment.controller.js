import BaseController from './base.controller.js';
import { paymentService } from '../services/payment.service.js';
import catchAsync from '../utils/catchAsync.util.js';
import crypto from 'crypto';

class PaymentController extends BaseController {
  
  createOrder = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const { coinPackId } = req.body;

    if (!coinPackId) {
      return this.sendError(res, 400, 'coinPackId is required');
    }

    const orderData = await paymentService.createCoinPackOrder(userId, coinPackId);
    this.sendResponse(res, 201, 'Payment order created successfully', orderData);
  });

  handleWebhook = catchAsync(async (req, res) => {
    // Razorpay sends signature in this header
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret';
    
    // Raw body buffer is typically needed for signature verification
    // but assuming body-parser json is used, stringifying req.body might work for testing.
    // In production, you might need req.rawBody
    const payload = JSON.stringify(req.body);

    const result = await paymentService.handleRazorpayWebhook(payload, signature, secret);
    
    // Always return 200 OK to Razorpay so it doesn't retry
    return res.status(200).json(result);
  });

  /**
   * MOCK endpoint for local testing
   * This mimics the webhook trigger without actually receiving an internet webhook
   */
  mockWebhook = catchAsync(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return this.sendError(res, 400, 'orderId is required for mock webhook');

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret';
    
    // Create a mock Razorpay payload
    const mockPayloadObject = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_mock_${Date.now()}`,
            order_id: orderId,
            status: 'captured'
          }
        }
      }
    };
    
    const payloadString = JSON.stringify(mockPayloadObject);

    // Generate a valid signature for our mock payload
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');

    const result = await paymentService.handleRazorpayWebhook(payloadString, signature, secret);
    this.sendResponse(res, 200, 'Mock webhook processed', result);
  });
}

export const paymentController = new PaymentController();
