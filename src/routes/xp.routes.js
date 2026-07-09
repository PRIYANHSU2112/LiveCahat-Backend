import express from 'express';
import xpController from '../controllers/xp.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createLevelConfigSchema,
  updateLevelConfigSchema,
  createRewardSchema,
  updateRewardSchema,
  updateXpActionSchema,
  adminGrantXpSchema,
  adminTransactionsQuerySchema,
  adminRewardClaimsQuerySchema,
  rewardInventoryQuerySchema,
  claimRewardSchema,
} from '../validators/xp.validator.js';

const router = express.Router();

// All XP endpoints require authentication
router.use(authenticate);

// ─── User Endpoints ─────────────────────────────────────────────
router.get('/profile', xpController.getProfile);
router.get('/history', xpController.getHistory);
router.get('/leaderboard', xpController.getLeaderboard);

// Reward Inventory (claimable level-up rewards)
router.get('/rewards/inventory', validate(rewardInventoryQuerySchema), xpController.getRewardInventory);
router.post('/rewards/claim-all', xpController.claimAllRewards);
router.post('/rewards/:inventoryId/claim', validate(claimRewardSchema), xpController.claimReward);

// ─── Admin Endpoints (ADMIN only) ───────────────────────────────
router.use(restrictTo('ADMIN'));

// Admin stats & audit (register before parameterized routes)
router.get('/admin/stats', xpController.getAdminStats);
router.get('/admin/transactions', validate(adminTransactionsQuerySchema), xpController.listAdminTransactions);
router.get('/admin/reward-claims', validate(adminRewardClaimsQuerySchema), xpController.listAdminRewardClaims);

// Level Configs
router.get('/admin/level-configs', xpController.listLevelConfigs);
router.post('/admin/level-configs', validate(createLevelConfigSchema), xpController.createLevelConfig);
router.put('/admin/level-configs/:id', requireObjectId('id'), validate(updateLevelConfigSchema), xpController.updateLevelConfig);
router.delete('/admin/level-configs/:id', requireObjectId('id'), xpController.deleteLevelConfig);

// Level Rewards
router.get('/admin/rewards', xpController.listRewards);
router.post('/admin/rewards', validate(createRewardSchema), xpController.createReward);
router.put('/admin/rewards/:id', requireObjectId('id'), validate(updateRewardSchema), xpController.updateReward);
router.delete('/admin/rewards/:id', requireObjectId('id'), xpController.deleteReward);

// XP Action Configs
router.get('/admin/xp-actions', xpController.listXpActions);
router.put('/admin/xp-actions/:action', validate(updateXpActionSchema), xpController.updateXpAction);

// Manual XP Grant
router.post('/admin/grant', validate(adminGrantXpSchema), xpController.grantXp);

export default router;
