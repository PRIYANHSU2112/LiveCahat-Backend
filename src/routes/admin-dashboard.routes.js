import express from 'express';
import adminDashboardController from '../controllers/admin-dashboard.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  adminDashboardQuerySchema,
  adminDashboardListQuerySchema,
} from '../validators/admin-dashboard.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get(
  '/dashboard/summary',
  validate(adminDashboardQuerySchema),
  adminDashboardController.getSummary
);
router.get(
  '/dashboard/charts',
  validate(adminDashboardQuerySchema),
  adminDashboardController.getCharts
);
router.get(
  '/dashboard/listeners/busy',
  validate(adminDashboardListQuerySchema),
  adminDashboardController.getBusyListeners
);
router.get(
  '/dashboard/sessions/chat',
  validate(adminDashboardListQuerySchema),
  adminDashboardController.getChatSessions
);

export default router;
