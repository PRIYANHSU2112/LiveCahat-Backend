import express from 'express';
import userController from '../controllers/user.controller.js';
import roleController from '../controllers/role.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { uploadUserPhoto, processAndUploadImage } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  updateUserProfileSchema,
  updateSettingsSchema,
  queryUserSchema,
  blockUserSchema,
  createAdminSchema,
  createListenerSchema,
  createAgentSchema,
  paginationQuerySchema,
} from '../validators/user.validator.js';
import { assignAdminRoleSchema } from '../validators/role.validator.js';
import adminExportController from '../controllers/admin-export.controller.js';

const router = express.Router();

router.use(authenticate);

router.get('/me', userController.getMe);
router.put(
  '/me',
  uploadUserPhoto,
  processAndUploadImage,
  validate(updateUserProfileSchema),
  userController.updateMe
);
router.delete('/me', userController.deleteMe);
router.get('/me/settings', userController.getMySettings);
router.patch('/me/settings', validate(updateSettingsSchema), userController.updateMySettings);

// --- ADMIN ONLY ROUTES ---
router.use(restrictTo('ADMIN'));

router.get('/stats', authorize('user.stats.view'), userController.getCustomerStats);
router.get('/agent-stats', authorize('agent.stats.view'), userController.getAgentAdminStats);
router.get('/blocked-stats', authorize('user.read'), userController.getBlockedAccountStats);
router.get('/activity/stats', authorize('user.activity.view'), userController.getCustomerActivityStats);
router.get(
  '/activity/export',
  authorize('user.activity.view'),
  validate(paginationQuerySchema),
  adminExportController.exportUserActivity
);
router.get(
  '/activity',
  authorize('user.activity.view'),
  validate(paginationQuerySchema),
  userController.getCustomerActivityFeed
);

router.get('/export', authorize('user.read'), validate(queryUserSchema), adminExportController.exportUsers);
router.get('/', authorize('user.read'), validate(queryUserSchema), userController.getAllUsers);
router.post('/admin', authorize('admin.create'), validate(createAdminSchema), userController.createAdmin);
router.post(
  '/listener',
  authorize('listener.create'),
  validate(createListenerSchema),
  userController.createListener
);
router.post('/agent', authorize('agent.create'), validate(createAgentSchema), userController.createAgent);
router.patch(
  '/agent/:id/commission',
  authorize('agent.commission.update'),
  userController.updateAgentCommission
);
router.patch(
  '/admin/:id/role',
  authorize('role.update'),
  validate(assignAdminRoleSchema),
  roleController.assignAdminRole
);
router.get('/:id', authorize('user.read'), userController.getUserById);
router.post('/:id/block', authorize('user.block'), validate(blockUserSchema), userController.blockUser);

export default router;
