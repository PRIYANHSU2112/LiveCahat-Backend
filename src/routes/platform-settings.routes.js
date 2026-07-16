import express from 'express';
import platformSettingsController from '../controllers/platform-settings.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updatePlatformSettingsSchema } from '../validators/platform-settings.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get('/', authorize('platform_settings.read'), platformSettingsController.getSettings);
router.put(
  '/',
  authorize('platform_settings.update'),
  validate(updatePlatformSettingsSchema),
  platformSettingsController.updateSettings
);

export default router;
