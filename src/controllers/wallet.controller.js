import BaseController from './base.controller.js';
import { walletService } from '../services/wallet.service.js';
import catchAsync from '../utils/catchAsync.util.js';
import crypto from 'crypto';

class WalletController extends BaseController {

  getWallet = catchAsync(async (req, res) => {
    const wallet = await walletService.getOrCreateWallet(req.user._id);
    this.sendResponse(res, 200, 'Wallet details fetched successfully', wallet);
  });

  getCoinTransactions = catchAsync(async (req, res) => {
    const transactions = await walletService.getUserCoinTransactions(req.user._id, req.query);
    this.sendResponse(res, 200, 'Coin transactions fetched successfully', transactions);
  });

  getPaymentTransactions = catchAsync(async (req, res) => {
    const transactions = await walletService.getUserPaymentTransactions(req.user._id, req.query);
    this.sendResponse(res, 200, 'Payment transactions fetched successfully', transactions);
  });

  createOrder = catchAsync(async (req, res) => {
    const userId = req.user._id;
    const { coinPackId } = req.body;

    if (!coinPackId) {
      return this.sendError(res, 400, 'coinPackId is required');
    }

    const orderData = await walletService.createCoinPackOrder(userId, coinPackId);
    this.sendResponse(res, 201, 'Payment order created successfully', orderData);
  });

  handleWebhook = catchAsync(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const { default: settingsRuntime } = await import('../services/settings-runtime.service.js');
    const secret = settingsRuntime.getRazorpayWebhookSecret();
    const payload = JSON.stringify(req.body);

    const result = await walletService.handleRazorpayWebhook(payload, signature, secret);
    return res.status(200).json(result);
  });

  mockWebhook = catchAsync(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) {
      return this.sendError(res, 400, 'orderId is required for mock webhook');
    }

    const { default: settingsRuntime } = await import('../services/settings-runtime.service.js');
    const secret = settingsRuntime.getRazorpayWebhookSecret();

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

  getAdminStats = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAdminStats(req.query);
    this.sendResponse(res, 200, 'Wallet stats fetched successfully', result);
  });

  getAllWallets = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAllWallets(req.query);
    this.sendResponse(res, 200, 'All wallets fetched successfully', result);
  });

  getWalletById = catchAsync(async (req, res) => {
    const wallet = await walletService.adminGetWalletById(req.params.id);
    this.sendResponse(res, 200, 'Wallet details fetched successfully', wallet);
  });

  getWalletByUserId = catchAsync(async (req, res) => {
    const wallet = await walletService.adminGetWalletByUserId(req.params.userId);
    this.sendResponse(res, 200, 'Wallet details fetched successfully', wallet);
  });

  updateWalletStatus = catchAsync(async (req, res) => {
    const wallet = await walletService.adminUpdateWalletStatus(req.params.id, req.body.status);
    this.sendResponse(res, 200, `Wallet status updated to ${req.body.status} successfully`, wallet);
  });

  creditDebitCoins = catchAsync(async (req, res) => {
    const result = await walletService.adminCreditDebitCoins(
      req.params.userId,
      req.body,
      req.user._id
    );
    this.sendResponse(res, 200, 'Wallet balance adjusted successfully', result);
  });

  getAllCoinTransactions = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAllCoinTransactions(req.query);
    this.sendResponse(res, 200, 'All coin transactions fetched successfully', result);
  });

  getAllPaymentTransactions = catchAsync(async (req, res) => {
    const result = await walletService.adminGetAllPaymentTransactions(req.query);
    this.sendResponse(res, 200, 'All payment transactions fetched successfully', result);
  });
}

export default new WalletController();
export const walletController = new WalletController();
