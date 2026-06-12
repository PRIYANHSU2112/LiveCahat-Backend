import express from 'express';
import giftController from '../controllers/gift.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createGiftSchema, updateGiftSchema, sendGiftSchema, queryGiftSchema } from '../validators/gift.validator.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Publicly listing active/available gifts & history
router.get('/', validate(queryGiftSchema), giftController.getAllGifts);
router.get('/history/sent', giftController.getSentGiftsHistory);
router.get('/history/received', giftController.getReceivedGiftsHistory);
router.get('/:id', giftController.getGiftById);

// Send virtual gifts (accessible by Customers and Admins)
router.post('/send', validate(sendGiftSchema), giftController.sendGift);

// Admin-only management & analytics endpoints
router.use(restrictTo('ADMIN'));

router.get('/admin/analytics', giftController.getAdminGiftAnalytics);
router.post('/', validate(createGiftSchema), giftController.createGift);
router.put('/:id', validate(updateGiftSchema), giftController.updateGift);
router.delete('/:id', giftController.deleteGift);

export default router;
