import express from 'express';
import giftController from '../controllers/gift.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createGiftSchema,
  updateGiftSchema,
  sendGiftSchema,
  queryGiftSchema,
  adminGiftListQuerySchema,
} from '../validators/gift.validator.js';
import { optionalGiftIconUpload } from '../middlewares/optional-upload.middleware.js';

const router = express.Router();

router.use(authenticate);

// Public listing & history
router.get('/', validate(queryGiftSchema), giftController.getAllGifts);
router.get('/history/sent', giftController.getSentGiftsHistory);
router.get('/history/received', giftController.getReceivedGiftsHistory);

// Admin read routes MUST be registered before /:id (otherwise "admin" matches :id → 400)
router.get('/admin/analytics', restrictTo('ADMIN'), giftController.getAdminGiftAnalytics);
router.get('/admin/stats', restrictTo('ADMIN'), giftController.getAdminGiftStats);
router.get('/admin', restrictTo('ADMIN'), validate(adminGiftListQuerySchema), giftController.getAdminGifts);

router.post('/send', validate(sendGiftSchema), giftController.sendGift);
router.get('/:id', requireObjectId('id'), giftController.getGiftById);

// Admin write routes
router.use(restrictTo('ADMIN'));
router.post('/', optionalGiftIconUpload, validate(createGiftSchema), giftController.createGift);
router.put('/:id', requireObjectId('id'), optionalGiftIconUpload, validate(updateGiftSchema), giftController.updateGift);
router.delete('/:id', requireObjectId('id'), giftController.deleteGift);

export default router;
