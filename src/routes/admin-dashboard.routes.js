import express from 'express';
import adminDashboardController from '../controllers/admin-dashboard.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  adminDashboardQuerySchema,
  adminDashboardListQuerySchema,
} from '../validators/admin-dashboard.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get(
  '/dashboard/summary',
  authorize('dashboard.view'),
  validate(adminDashboardQuerySchema),
  adminDashboardController.getSummary
);
router.get(
  '/dashboard/charts',
  authorize('dashboard.view'),
  validate(adminDashboardQuerySchema),
  adminDashboardController.getCharts
);
router.get(
  '/dashboard/listeners/busy',
  authorize('dashboard.view'),
  validate(adminDashboardListQuerySchema),
  adminDashboardController.getBusyListeners
);
router.get(
  '/dashboard/sessions/chat',
  authorize('dashboard.view'),
  validate(adminDashboardListQuerySchema),
  adminDashboardController.getChatSessions
);

export default router;
