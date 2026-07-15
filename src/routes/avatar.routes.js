import express from 'express';
import avatarController from '../controllers/avatar.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createAvatarSchema,
  updateAvatarSchema,
  adminAvatarListQuerySchema,
} from '../validators/avatar.validator.js';
import { optionalBannerImageUpload } from '../middlewares/optional-upload.middleware.js';
import adminExportController from '../controllers/admin-export.controller.js';

const router = express.Router();

// Enforce authentication on all avatar endpoints
router.use(authenticate);

// --- User/Listener Endpoints ---
router.get('/', avatarController.list);
router.post('/:avatarId/unlock', avatarController.unlock);
router.post('/:avatarId/set-profile', avatarController.setAsProfile);

// --- Admin Endpoints (Restricted to ADMIN users only) ---
router.use(restrictTo('ADMIN'));
router.get('/admin/stats', authorize('avatar.stats.view'), avatarController.getAdminStats);
router.get('/admin/export', authorize('avatar.read'), validate(adminAvatarListQuerySchema), adminExportController.exportAvatars);
router.get('/admin', authorize('avatar.read'), validate(adminAvatarListQuerySchema), avatarController.listAdmin);
router.post('/admin', authorize('avatar.create'), optionalBannerImageUpload, validate(createAvatarSchema), avatarController.create);
router.put('/admin/:id', authorize('avatar.update'), optionalBannerImageUpload, validate(updateAvatarSchema), avatarController.update);
router.delete('/admin/:id', authorize('avatar.delete'), avatarController.delete);

export default router;
