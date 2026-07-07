import express from 'express';
import avatarController from '../controllers/avatar.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createAvatarSchema,
  updateAvatarSchema,
  adminAvatarListQuerySchema,
} from '../validators/avatar.validator.js';
import { optionalBannerImageUpload } from '../middlewares/optional-upload.middleware.js';

const router = express.Router();

// Enforce authentication on all avatar endpoints
router.use(authenticate);

// --- User/Listener Endpoints ---
router.get('/', avatarController.list);
router.post('/:avatarId/unlock', avatarController.unlock);
router.post('/:avatarId/set-profile', avatarController.setAsProfile);

// --- Admin Endpoints (Restricted to ADMIN users only) ---
router.use(restrictTo('ADMIN'));
router.get('/admin/stats', avatarController.getAdminStats);
router.get('/admin', validate(adminAvatarListQuerySchema), avatarController.listAdmin);
router.post('/admin', optionalBannerImageUpload, validate(createAvatarSchema), avatarController.create);
router.put('/admin/:id', optionalBannerImageUpload, validate(updateAvatarSchema), avatarController.update);
router.delete('/admin/:id', avatarController.delete);

export default router;
