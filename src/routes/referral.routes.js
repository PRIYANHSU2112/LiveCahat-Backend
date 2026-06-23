import express from 'express';
import referralController from '../controllers/referral.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { applyReferralSchema, updateReferralConfigSchema } from '../validators/referral.validator.js';

const router = express.Router();

router.use(authenticate);

// ─── Authenticated users ────────────────────────────────────────
router.get('/details', referralController.getReferralDetails);
router.post('/apply', validate(applyReferralSchema), referralController.applyReferralCode);

// ─── Admin only ─────────────────────────────────────────────────
router.use(restrictTo('ADMIN'));
router.get('/admin/config', referralController.getReferralConfig);
router.put('/admin/config', validate(updateReferralConfigSchema), referralController.updateReferralConfig);

export default router;
