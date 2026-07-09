import express from 'express';
import dailyRewardController from '../controllers/daily-reward.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  updateDaysConfigSchema,
  updateWeeksConfigSchema,
  adminStatsQuerySchema,
  adminClaimsQuerySchema,
} from '../validators/daily-reward.validator.js';

const router = express.Router();

// Enforce authentication on all daily rewards endpoints
router.use(authenticate);

// --- User Endpoints ---
router.get('/state', dailyRewardController.getState);
router.post('/claim', dailyRewardController.claimReward);
router.get('/inventory', dailyRewardController.getInventory);
router.post('/inventory/:inventoryId/open', dailyRewardController.openInventoryGift);

// --- Admin Endpoints (Restricted to ADMIN users only) ---
router.use(restrictTo('ADMIN'));

router.get('/admin/config', dailyRewardController.getAdminConfig);
router.get('/admin/stats', validate(adminStatsQuerySchema), dailyRewardController.getAdminStats);
router.get('/admin/claims', validate(adminClaimsQuerySchema), dailyRewardController.listAdminClaims);
router.put('/admin/config/days', validate(updateDaysConfigSchema), dailyRewardController.updateDaysConfig);
router.put('/admin/config/weeks', validate(updateWeeksConfigSchema), dailyRewardController.updateWeeksConfig);
router.post('/admin/cache/clear', dailyRewardController.clearCache);

export default router;
