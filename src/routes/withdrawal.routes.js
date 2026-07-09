import express from 'express';
import withdrawalController from '../controllers/withdrawal.controller.js';
import bankAccountController from '../controllers/bank-account.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import { createBankAccountSchema } from '../validators/bank-account.validator.js';
import {
  quoteQuerySchema,
  createWithdrawalSchema,
  listWithdrawalQuerySchema,
  withdrawalStatsQuerySchema,
  rejectWithdrawalSchema,
  updateWithdrawalConfigSchema,
  adminStatsQuerySchema,
  idParamSchema,
} from '../validators/withdrawal.validator.js';
import {
  runSettlementsSchema,
  adminListSettlementsQuerySchema,
} from '../validators/agent-settlement.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate);

// ─── Saved bank accounts ────────────────────────────────────────
router.post('/bank-accounts', validate(createBankAccountSchema), bankAccountController.addBankAccount);
router.get('/bank-accounts', bankAccountController.getMyBankAccounts);
router.delete('/bank-accounts/:id', validate(idParamSchema), bankAccountController.deleteBankAccount);

// ─── Withdrawal (config + quote readable by authed users) ───────
router.get('/config', withdrawalController.getConfig);
router.get('/quote', validate(quoteQuerySchema), withdrawalController.quote);
router.post('/', validate(createWithdrawalSchema), withdrawalController.requestWithdrawal);
router.get('/me/stats', validate(withdrawalStatsQuerySchema), withdrawalController.getMyWithdrawalStats);
router.get('/me', validate(listWithdrawalQuerySchema), withdrawalController.getMyWithdrawals);

// ─── Admin (declared before /:id to avoid param capture) ────────
router.put('/admin/config', adminOnly, validate(updateWithdrawalConfigSchema), withdrawalController.updateConfig);
router.get('/admin/stats', adminOnly, validate(adminStatsQuerySchema), withdrawalController.getAdminWithdrawalStats);
router.get(
  '/admin/settlements',
  adminOnly,
  validate(adminListSettlementsQuerySchema),
  withdrawalController.adminListSettlements
);
router.get('/admin', adminOnly, validate(listWithdrawalQuerySchema), withdrawalController.adminListWithdrawals);
router.get(
  '/admin/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  withdrawalController.adminGetWithdrawalById
);
router.post('/admin/settlements/run', adminOnly, validate(runSettlementsSchema), withdrawalController.runSettlements);
router.patch(
  '/admin/:id/approve',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  withdrawalController.adminApprove
);
router.patch(
  '/admin/:id/reject',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  validate(rejectWithdrawalSchema),
  withdrawalController.adminReject
);

// ─── User param routes (last) ───────────────────────────────────
router.get('/:id', validate(idParamSchema), withdrawalController.getWithdrawalById);
router.post('/:id/cancel', validate(idParamSchema), withdrawalController.cancelWithdrawal);

export default router;
