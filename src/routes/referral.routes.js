import express from 'express';
import referralController from '../controllers/referral.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { applyReferralSchema, updateReferralConfigSchema, adminReferralsQuerySchema } from '../validators/referral.validator.js';
import adminExportController from '../controllers/admin-export.controller.js';

const router = express.Router();

router.use(authenticate);

// ─── Authenticated users ────────────────────────────────────────
router.get('/details', referralController.getReferralDetails);
router.post('/apply', validate(applyReferralSchema), referralController.applyReferralCode);

// ─── Admin only ─────────────────────────────────────────────────
router.use(restrictTo('ADMIN'));
router.get('/admin/stats', authorize('referral.stats.view'), referralController.getAdminStats);
router.get('/admin/referrals/export', authorize('referral.read'), validate(adminReferralsQuerySchema), adminExportController.exportReferrals);
router.get('/admin/referrals', authorize('referral.read'), validate(adminReferralsQuerySchema), referralController.getAdminReferrals);
router.get('/admin/config', authorize('referral.config.read'), referralController.getReferralConfig);
router.put('/admin/config', authorize('referral.config.update'), validate(updateReferralConfigSchema), referralController.updateReferralConfig);

export default router;
