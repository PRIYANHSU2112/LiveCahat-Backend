import express from 'express';
import coinPackController from '../controllers/coin-pack.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createCoinPackSchema,
  updateCoinPackSchema,
  adminCoinPackListQuerySchema,
} from '../validators/coin-pack.validator.js';

const router = express.Router();

router.use(authenticate);

// Public list for customers/listeners (active packs, cached)
router.get('/', coinPackController.getAllCoinPacks);

// Admin read routes before /:id
router.get('/admin/stats', restrictTo('ADMIN'), coinPackController.getAdminStats);
router.get(
  '/admin',
  restrictTo('ADMIN'),
  validate(adminCoinPackListQuerySchema),
  coinPackController.getAdminCoinPacks,
);

router.get('/:id', requireObjectId('id'), coinPackController.getCoinPackById);

// Admin write routes
router.use(restrictTo('ADMIN'));
router.post('/', validate(createCoinPackSchema), coinPackController.createCoinPack);
router.put('/:id', requireObjectId('id'), validate(updateCoinPackSchema), coinPackController.updateCoinPack);
router.patch('/:id/toggle', requireObjectId('id'), coinPackController.toggleCoinPack);
router.delete('/:id', requireObjectId('id'), coinPackController.deleteCoinPack);

export default router;
