import express from 'express';
import userController from '../controllers/user.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { uploadUserPhoto, processAndUploadImage } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updateUserProfileSchema, queryUserSchema, blockUserSchema, createAdminSchema, createListenerSchema } from '../validators/user.validator.js';

const router = express.Router();

router.use(authenticate);

router.get('/me', userController.getMe);

router.put('/me', uploadUserPhoto, processAndUploadImage, validate(updateUserProfileSchema), userController.updateMe);

router.delete('/me', userController.deleteMe);

// --- ADMIN ONLY ROUTES ---
router.use(restrictTo('ADMIN'));

router.get('/', validate(queryUserSchema), userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.post('/:id/block', validate(blockUserSchema), userController.blockUser);
router.post('/admin', validate(createAdminSchema), userController.createAdmin);
router.post('/listener', validate(createListenerSchema), userController.createListener);

export default router;
