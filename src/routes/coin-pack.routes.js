import express from 'express';
import coinPackController from '../controllers/coin-pack.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(authenticate);

// Public APIs for authenticated users (Customers & Listeners)
router.get('/', coinPackController.getAllCoinPacks);
router.get('/:id', coinPackController.getCoinPackById);

// Admin-only CRUD operations
router.use(restrictTo('ADMIN'));

router.post('/', coinPackController.createCoinPack);
router.put('/:id', coinPackController.updateCoinPack);
router.patch('/:id/toggle', coinPackController.toggleCoinPack);
router.delete('/:id', coinPackController.deleteCoinPack);

export default router;
