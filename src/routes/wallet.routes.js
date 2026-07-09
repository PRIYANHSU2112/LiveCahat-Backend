import express from 'express';
import walletController from '../controllers/wallet.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  getTransactionsSchema,
  adminCreditDebitSchema,
  adminUpdateWalletStatusSchema,
  getWalletsSchema,
  adminStatsQuerySchema,
  idParamSchema,
  userIdParamSchema,
} from '../validators/wallet.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

// --- PUBLIC/WEBHOOK ENGINES (NOT authenticated) ---
router.post('/payments/webhook', walletController.handleWebhook);
router.post('/payments/webhook-mock', walletController.mockWebhook);

// --- AUTHENTICATED USER ROUTES ---
router.use(authenticate);

router.get('/me', walletController.getWallet);
router.get('/me/coin-transactions', validate(getTransactionsSchema), walletController.getCoinTransactions);
router.get('/me/payment-transactions', validate(getTransactionsSchema), walletController.getPaymentTransactions);
router.post('/payments/create-order', walletController.createOrder);

// --- ADMIN PANEL — register before any /:id user routes ---
router.get('/admin/stats', adminOnly, validate(adminStatsQuerySchema), walletController.getAdminStats);
router.get('/admin', adminOnly, validate(getWalletsSchema), walletController.getAllWallets);
router.get(
  '/admin/coin-transactions',
  adminOnly,
  validate(getTransactionsSchema),
  walletController.getAllCoinTransactions
);
router.get(
  '/admin/payment-transactions',
  adminOnly,
  validate(getTransactionsSchema),
  walletController.getAllPaymentTransactions
);
router.get(
  '/admin/user/:userId',
  adminOnly,
  requireObjectId('userId'),
  validate(userIdParamSchema),
  walletController.getWalletByUserId
);
router.post(
  '/admin/user/:userId/credit-debit',
  adminOnly,
  requireObjectId('userId'),
  validate(userIdParamSchema),
  validate(adminCreditDebitSchema),
  walletController.creditDebitCoins
);
router.put(
  '/admin/:id/status',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  validate(adminUpdateWalletStatusSchema),
  walletController.updateWalletStatus
);
router.get(
  '/admin/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  walletController.getWalletById
);

export default router;
