import express from 'express';
import anchorLevelController from '../controllers/anchor-level.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createLevelSchema,
  updateLevelSchema,
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

// ─── Admin (declared before /:id-style param routes; none here clash) ──
router.post('/admin', adminOnly, validate(createLevelSchema), anchorLevelController.createLevel);
router.get('/admin', adminOnly, anchorLevelController.getAllLevels);
router.get('/admin/claims', adminOnly, validate(claimsQuerySchema), anchorLevelController.getClaims);
router.put('/admin/:id', adminOnly, validate(idParamSchema), validate(updateLevelSchema), anchorLevelController.updateLevel);
router.delete('/admin/:id', adminOnly, validate(idParamSchema), anchorLevelController.deleteLevel);

// ─── Shared ladder (any authenticated user) ─────────────────────
router.get('/', anchorLevelController.getLadder);

export default router;
