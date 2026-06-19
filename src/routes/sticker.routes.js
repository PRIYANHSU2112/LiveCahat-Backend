import express from 'express';
import stickerController from '../controllers/sticker.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createStickerSchema,
  updateStickerSchema,
  listStickerQuerySchema,
  idParamSchema,
} from '../validators/sticker.validator.js';

const router = express.Router();

router.use(authenticate);

// ─── User + Admin (authenticated) ───────────────────────────────
router.get('/', validate(listStickerQuerySchema), stickerController.getAllStickers);
router.get('/:id', validate(idParamSchema), stickerController.getStickerById);
router.post('/:id/unlock', validate(idParamSchema), stickerController.unlockSticker);

// ─── Admin only ─────────────────────────────────────────────────
router.use(restrictTo('ADMIN'));
router.post('/', validate(createStickerSchema), stickerController.createSticker);
router.put('/:id', validate(idParamSchema), validate(updateStickerSchema), stickerController.updateSticker);
router.patch('/:id/toggle', validate(idParamSchema), stickerController.toggleSticker);
router.delete('/:id', validate(idParamSchema), stickerController.deleteSticker);

export default router;
