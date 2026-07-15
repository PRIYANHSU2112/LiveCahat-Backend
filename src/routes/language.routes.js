import express from 'express';
import languageController from '../controllers/language.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createLanguageSchema,
  updateLanguageSchema,
  listLanguageQuerySchema,
  idParamSchema,
} from '../validators/language.validator.js';
import adminExportController from '../controllers/admin-export.controller.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate);

// ─── Admin stats (before /:id) ──────────────────────────────────
router.get('/admin/stats', adminOnly, authorize('language.stats.view'), languageController.getAdminStats);
router.get('/admin/export', adminOnly, authorize('language.read'), validate(listLanguageQuerySchema), adminExportController.exportLanguages);

// ─── User + Admin (authenticated) ───────────────────────────────
router.get('/', validate(listLanguageQuerySchema), languageController.getAllLanguages);
router.get(
  '/:id',
  requireObjectId('id'),
  validate(idParamSchema),
  languageController.getLanguageById,
);

// ─── Admin only ─────────────────────────────────────────────────
router.post('/', adminOnly, authorize('language.create'), validate(createLanguageSchema), languageController.createLanguage);
router.put(
  '/:id',
  adminOnly,
  authorize('language.update'),
  requireObjectId('id'),
  validate(idParamSchema),
  validate(updateLanguageSchema),
  languageController.updateLanguage,
);
router.patch(
  '/:id/toggle',
  adminOnly,
  authorize('language.update'),
  requireObjectId('id'),
  validate(idParamSchema),
  languageController.toggleLanguage,
);
router.delete(
  '/:id',
  adminOnly,
  authorize('language.delete'),
  requireObjectId('id'),
  validate(idParamSchema),
  languageController.deleteLanguage,
);

export default router;
