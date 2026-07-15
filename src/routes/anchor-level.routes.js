import express from 'express';
import anchorLevelController from '../controllers/anchor-level.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createLevelSchema,
  updateLevelSchema,
  adminLevelsQuerySchema,
  claimsQuerySchema,
  inventoryQuerySchema,
  idParamSchema,
} from '../validators/anchor-level.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');
const listenerOnly = restrictTo('LISTENER');

router.use(authenticate);

// ─── Listener ───────────────────────────────────────────────────
router.get('/me/status', listenerOnly, anchorLevelController.getMyStatus);
router.get('/me/rewards', listenerOnly, validate(inventoryQuerySchema), anchorLevelController.getRewardInventory);
router.post('/me/rewards/claim-all', listenerOnly, anchorLevelController.claimAllRewards);
router.post('/me/rewards/:id/claim', listenerOnly, validate(idParamSchema), anchorLevelController.claimReward);

// ─── Admin (static /admin/* routes before /admin/:id) ───────────
router.get('/admin/stats', adminOnly, authorize('anchor_level.stats.view'), anchorLevelController.getAdminStats);
router.get('/admin/claims', adminOnly, authorize('anchor_level.claims.read'), validate(claimsQuerySchema), anchorLevelController.getClaims);
router.post('/admin', adminOnly, authorize('anchor_level.create'), validate(createLevelSchema), anchorLevelController.createLevel);
router.get('/admin', adminOnly, authorize('anchor_level.read'), validate(adminLevelsQuerySchema), anchorLevelController.getAllLevels);
router.put(
  '/admin/:id',
  adminOnly,
  authorize('anchor_level.update'),
  requireObjectId('id'),
  validate(idParamSchema),
  validate(updateLevelSchema),
  anchorLevelController.updateLevel,
);
router.delete(
  '/admin/:id',
  adminOnly,
  authorize('anchor_level.delete'),
  requireObjectId('id'),
  validate(idParamSchema),
  anchorLevelController.deleteLevel,
);

// ─── Shared ladder (any authenticated user) ─────────────────────
router.get('/', anchorLevelController.getLadder);

export default router;
