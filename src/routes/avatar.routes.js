import express from 'express';
import avatarController from '../controllers/avatar.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createAvatarSchema, updateAvatarSchema } from '../validators/avatar.validator.js';

const router = express.Router();

// Enforce authentication on all avatar endpoints
router.use(authenticate);

// --- User/Listener Endpoints ---
router.get('/', avatarController.list);
router.post('/:avatarId/unlock', avatarController.unlock);

// --- Admin Endpoints (Restricted to ADMIN users only) ---
router.use(restrictTo('ADMIN'));
router.post('/admin', validate(createAvatarSchema), avatarController.create);
router.put('/admin/:id', validate(updateAvatarSchema), avatarController.update);
router.delete('/admin/:id', avatarController.delete);

export default router;
