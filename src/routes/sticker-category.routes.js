import express from 'express';
import stickerCategoryController from '../controllers/sticker-category.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createCategorySchema,
  updateCategorySchema,
  listCategoryQuerySchema,
  idParamSchema,
} from '../validators/sticker.validator.js';

const router = express.Router();

router.use(authenticate);

// ─── User + Admin (authenticated) ───────────────────────────────
router.get('/', validate(listCategoryQuerySchema), stickerCategoryController.getAllCategories);
router.get('/:id', validate(idParamSchema), stickerCategoryController.getCategoryById);

// ─── Admin only ─────────────────────────────────────────────────
router.use(restrictTo('ADMIN'));
router.post('/', validate(createCategorySchema), stickerCategoryController.createCategory);
router.put('/:id', validate(idParamSchema), validate(updateCategorySchema), stickerCategoryController.updateCategory);
router.patch('/:id/toggle', validate(idParamSchema), stickerCategoryController.toggleCategory);
router.delete('/:id', validate(idParamSchema), stickerCategoryController.deleteCategory);

export default router;
