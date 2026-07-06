import express from 'express';
import userController from '../controllers/user.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { uploadUserPhoto, processAndUploadImage } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updateUserProfileSchema, updateSettingsSchema, queryUserSchema, blockUserSchema, createAdminSchema, createListenerSchema, createAgentSchema, paginationQuerySchema } from '../validators/user.validator.js';

const router = express.Router();

router.use(authenticate);

router.get('/me', userController.getMe);

router.put('/me', uploadUserPhoto, processAndUploadImage, validate(updateUserProfileSchema), userController.updateMe);

router.delete('/me', userController.deleteMe);

router.get('/me/settings', userController.getMySettings);

router.patch('/me/settings', validate(updateSettingsSchema), userController.updateMySettings);

// --- ADMIN ONLY ROUTES ---
router.use(restrictTo('ADMIN'));

router.get('/stats', userController.getCustomerStats);
router.get('/activity/stats', userController.getCustomerActivityStats);
router.get('/activity', validate(paginationQuerySchema), userController.getCustomerActivityFeed);

router.get('/', validate(queryUserSchema), userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.post('/:id/block', validate(blockUserSchema), userController.blockUser);
router.post('/admin', validate(createAdminSchema), userController.createAdmin);
router.post('/listener', validate(createListenerSchema), userController.createListener);
router.post('/agent', validate(createAgentSchema), userController.createAgent);
router.patch('/agent/:id/commission', userController.updateAgentCommission);

export default router;
