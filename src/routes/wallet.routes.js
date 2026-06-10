import express from 'express';
import walletController from '../controllers/wallet.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  getTransactionsSchema,
  adminCreditDebitSchema,
  adminUpdateWalletStatusSchema,
  getWalletsSchema
} from '../validators/wallet.validator.js';

const router = express.Router();

// --- PUBLIC/WEBHOOK ENGINES (NOT authenticated) ---
// Razorpay webhook handles verification internally
router.post('/payments/webhook', walletController.handleWebhook);
router.post('/payments/webhook-mock', walletController.mockWebhook);

// --- AUTHENTICATED USER ROUTES ---
router.use(authenticate);

router.get('/me', walletController.getWallet);
router.get('/me/coin-transactions', validate(getTransactionsSchema), walletController.getCoinTransactions);
router.get('/me/payment-transactions', validate(getTransactionsSchema), walletController.getPaymentTransactions);

// Payment Purchase
router.post('/payments/create-order', walletController.createOrder);

// --- ADMIN ONLY ROUTES ---
router.use(restrictTo('ADMIN'));

router.get('/', validate(getWalletsSchema), walletController.getAllWallets);
router.get('/coin-transactions', validate(getTransactionsSchema), walletController.getAllCoinTransactions);
router.get('/payment-transactions', validate(getTransactionsSchema), walletController.getAllPaymentTransactions);
router.get('/:id', walletController.getWalletById);
router.post('/user/:userId/credit-debit', validate(adminCreditDebitSchema), walletController.creditDebitCoins);
router.put('/:id/status', validate(adminUpdateWalletStatusSchema), walletController.updateWalletStatus);

export default router;
