import express from 'express';
import { paymentController } from '../controllers/payment.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = express.Router();

// 1. Create Order (Requires Authentication)
router.post('/create-order', authenticate, paymentController.createOrder);

// 2. Razorpay Webhook (Public, Razorpay calls this)
router.post('/webhook', paymentController.handleWebhook);

// 3. Mock Webhook for Testing (Should be disabled in production)
router.post('/webhook-mock', paymentController.mockWebhook);

export default router;
