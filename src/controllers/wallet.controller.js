import BaseController from './base.controller.js';
import { walletService } from '../services/wallet.service.js';
import catchAsync from '../utils/catchAsync.util.js';
import crypto from 'crypto';

class WalletController extends BaseController {

  /**
   * Get current user's wallet
   */
  getWallet = catchAsync(async (req, res) => {
    const wallet = await walletService.getOrCreateWallet(req.user._id);
    this.sendResponse(res, 200, 'Wallet details fetched successfully', wallet);
  });

  /**
   * Get current user's coin transactions
   */
  getCoinTransactions = catchAsync(async (req, res) => {
    const transactions = await walletService.getUserCoinTransactions(req.user._id, req.query);
    this.sendResponse(res, 200, 'Coin transactions fetched successfully', transactions);
  });

  /**
   * Get current user's payment transactions
   */
  getPaymentTransactions = catchAsync(async (req, res) => {
    const transactions = await walletService.getUserPaymentTransactions(req.user._id, req.query);
    this.sendResponse(res, 200, 'Payment transactions fetched successfully', transactions);
  });

  /**
   * Create Razorpay payment order (replaces paymentController.createOrder)
   */
  createOrder = catchAsync(async (req, res) => {
    const userId = req.user._id;
    const { coinPackId } = req.body;

    if (!coinPackId) {
      return this.sendError(res, 400, 'coinPackId is required');
    }

    const orderData = await walletService.createCoinPackOrder(userId, coinPackId);
    this.sendResponse(res, 201, 'Payment order created successfully', orderData);
  });

  /**
   * Handle Razorpay webhook callback (replaces paymentController.handleWebhook)
   */
  handleWebhook = catchAsync(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret';
    const payload = JSON.stringify(req.body);

    const result = await walletService.handleRazorpayWebhook(payload, signature, secret);
    return res.status(200).json(result);
  });

  /**
   * Mock endpoint for local testing (replaces paymentController.mockWebhook)
   */
  mockWebhook = catchAsync(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) {
      return this.sendError(res, 400, 'orderId is required for mock webhook');
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret';

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

    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');

    const result = await walletService.handleRazorpayWebhook(payloadString, signature, secret);
    this.sendResponse(res, 200, 'Mock webhook processed', result);
  });

  // --- ADMIN CONTROLLERS ---

  /**
   * Admin: List all wallets
   */
  getAllWallets = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAllWallets(req.query);
    this.sendResponse(res, 200, 'All wallets fetched successfully', result);
  });

  /**
   * Admin: Get specific wallet details
   */
  getWalletById = catchAsync(async (req, res) => {
    const wallet = await walletService.getItemById(req.params.id);
    if (!wallet) {
      return this.sendError(res, 404, 'Wallet not found');
    }
    this.sendResponse(res, 200, 'Wallet details fetched successfully', wallet);
  });

  /**
   * Admin: Update wallet status
   */
  updateWalletStatus = catchAsync(async (req, res) => {
    const wallet = await walletService.adminUpdateWalletStatus(req.params.id, req.body.status);
    this.sendResponse(res, 200, `Wallet status updated to ${req.body.status} successfully`, wallet);
  });

  /**
   * Admin: Manual credit/debit adjustment
   */
  creditDebitCoins = catchAsync(async (req, res) => {
    const result = await walletService.adminCreditDebitCoins(req.params.userId, req.body);
    this.sendResponse(res, 200, 'Wallet balance adjusted successfully', result);
  });

  /**
   * Admin: List all coin transactions
   */
  getAllCoinTransactions = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAllCoinTransactions(req.query);
    this.sendResponse(res, 200, 'All coin transactions fetched successfully', result);
  });

  /**
   * Admin: List all payment transactions
   */
  getAllPaymentTransactions = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAllPaymentTransactions(req.query);
    this.sendResponse(res, 200, 'All payment transactions fetched successfully', result);
  });
}

export default new WalletController();
export const walletController = new WalletController(); // Export both default and named for flexibility
