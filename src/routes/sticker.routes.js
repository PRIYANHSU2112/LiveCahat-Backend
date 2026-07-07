import express from 'express';
import stickerController from '../controllers/sticker.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createStickerSchema,
  updateStickerSchema,
  listStickerQuerySchema,
  idParamSchema,
} from '../validators/sticker.validator.js';
import { optionalStickerImageUpload } from '../middlewares/optional-upload.middleware.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate);

// ─── Admin stats (before /:id) ──────────────────────────────────
router.get('/admin/stats', adminOnly, stickerController.getAdminStats);

// ─── User + Admin (authenticated) ───────────────────────────────
router.get('/', validate(listStickerQuerySchema), stickerController.getAllStickers);
router.get(
  '/:id',
  requireObjectId('id'),
  validate(idParamSchema),
  stickerController.getStickerById,
);
router.post(
  '/:id/unlock',
  requireObjectId('id'),
  validate(idParamSchema),
  stickerController.unlockSticker,
);

// ─── Admin only ─────────────────────────────────────────────────
router.post(
  '/',
  adminOnly,
  optionalStickerImageUpload,
  validate(createStickerSchema),
  stickerController.createSticker,
);
router.put(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  optionalStickerImageUpload,
  validate(idParamSchema),
  validate(updateStickerSchema),
  stickerController.updateSticker,
);
router.patch(
  '/:id/toggle',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  stickerController.toggleSticker,
);
router.delete(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  stickerController.deleteSticker,
);

export default router;
