import express from 'express';
import xpController from '../controllers/xp.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
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
router.get('/admin/stats', authorize('xp.stats.view'), xpController.getAdminStats);
router.get('/admin/transactions', authorize('xp.transaction.read'), validate(adminTransactionsQuerySchema), xpController.listAdminTransactions);
router.get('/admin/reward-claims', authorize('xp.reward_claim.read'), validate(adminRewardClaimsQuerySchema), xpController.listAdminRewardClaims);

// Level Configs
router.get('/admin/level-configs', authorize('xp.level_config.manage'), xpController.listLevelConfigs);
router.post('/admin/level-configs', authorize('xp.level_config.manage'), validate(createLevelConfigSchema), xpController.createLevelConfig);
router.put('/admin/level-configs/:id', authorize('xp.level_config.manage'), requireObjectId('id'), validate(updateLevelConfigSchema), xpController.updateLevelConfig);
router.delete('/admin/level-configs/:id', authorize('xp.level_config.manage'), requireObjectId('id'), xpController.deleteLevelConfig);

// Level Rewards
router.get('/admin/rewards', authorize('xp.reward.manage'), xpController.listRewards);
router.post('/admin/rewards', authorize('xp.reward.manage'), validate(createRewardSchema), xpController.createReward);
router.put('/admin/rewards/:id', authorize('xp.reward.manage'), requireObjectId('id'), validate(updateRewardSchema), xpController.updateReward);
router.delete('/admin/rewards/:id', authorize('xp.reward.manage'), requireObjectId('id'), xpController.deleteReward);

// XP Action Configs
router.get('/admin/xp-actions', authorize('xp.action.update'), xpController.listXpActions);
router.put('/admin/xp-actions/:action', authorize('xp.action.update'), validate(updateXpActionSchema), xpController.updateXpAction);

// Manual XP Grant
router.post('/admin/grant', authorize('xp.grant'), validate(adminGrantXpSchema), xpController.grantXp);

export default router;
