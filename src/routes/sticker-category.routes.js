import express from 'express';
import stickerCategoryController from '../controllers/sticker-category.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createCategorySchema,
  updateCategorySchema,
  listCategoryQuerySchema,
  idParamSchema,
} from '../validators/sticker.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate);

// ─── Admin stats (before /:id) ──────────────────────────────────
router.get('/admin/stats', adminOnly, stickerCategoryController.getAdminStats);

// ─── User + Admin (authenticated) ───────────────────────────────
router.get('/', validate(listCategoryQuerySchema), stickerCategoryController.getAllCategories);
router.get(
  '/:id',
  requireObjectId('id'),
  validate(idParamSchema),
  stickerCategoryController.getCategoryById,
);

// ─── Admin only ─────────────────────────────────────────────────
router.post('/', adminOnly, validate(createCategorySchema), stickerCategoryController.createCategory);
router.put(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  validate(updateCategorySchema),
  stickerCategoryController.updateCategory,
);
router.patch(
  '/:id/toggle',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  stickerCategoryController.toggleCategory,
);
router.delete(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  stickerCategoryController.deleteCategory,
);

export default router;
