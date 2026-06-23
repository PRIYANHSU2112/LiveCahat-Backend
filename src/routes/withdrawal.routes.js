import express from 'express';
import withdrawalController from '../controllers/withdrawal.controller.js';
import bankAccountController from '../controllers/bank-account.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createBankAccountSchema } from '../validators/bank-account.validator.js';
import {
  quoteQuerySchema,
  createWithdrawalSchema,
  listWithdrawalQuerySchema,
  rejectWithdrawalSchema,
  updateWithdrawalConfigSchema,
  idParamSchema,
} from '../validators/withdrawal.validator.js';

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
router.get('/me', validate(listWithdrawalQuerySchema), withdrawalController.getMyWithdrawals);

// ─── Admin (declared before /:id to avoid param capture) ────────
router.put('/admin/config', adminOnly, validate(updateWithdrawalConfigSchema), withdrawalController.updateConfig);
router.get('/admin', adminOnly, validate(listWithdrawalQuerySchema), withdrawalController.adminListWithdrawals);
router.patch('/admin/:id/approve', adminOnly, validate(idParamSchema), withdrawalController.adminApprove);
router.patch('/admin/:id/reject', adminOnly, validate(idParamSchema), validate(rejectWithdrawalSchema), withdrawalController.adminReject);

// ─── User param routes (last) ───────────────────────────────────
router.get('/:id', validate(idParamSchema), withdrawalController.getWithdrawalById);
router.post('/:id/cancel', validate(idParamSchema), withdrawalController.cancelWithdrawal);

export default router;
