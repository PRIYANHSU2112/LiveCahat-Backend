import express from 'express';
import languageController from '../controllers/language.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createLanguageSchema,
  updateLanguageSchema,
  listLanguageQuerySchema,
  idParamSchema,
} from '../validators/language.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate);

// ─── Admin stats (before /:id) ──────────────────────────────────
router.get('/admin/stats', adminOnly, languageController.getAdminStats);

// ─── User + Admin (authenticated) ───────────────────────────────
router.get('/', validate(listLanguageQuerySchema), languageController.getAllLanguages);
router.get(
  '/:id',
  requireObjectId('id'),
  validate(idParamSchema),
  languageController.getLanguageById,
);

// ─── Admin only ─────────────────────────────────────────────────
router.post('/', adminOnly, validate(createLanguageSchema), languageController.createLanguage);
router.put(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  validate(updateLanguageSchema),
  languageController.updateLanguage,
);
router.patch(
  '/:id/toggle',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  languageController.toggleLanguage,
);
router.delete(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  languageController.deleteLanguage,
);

export default router;
