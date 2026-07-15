import express from 'express';
import analyticsController from '../controllers/analytics.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { adminAnalyticsQuerySchema } from '../validators/admin-analytics.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get(
  '/admin/revenue',
  authorize('analytics.revenue.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getRevenueAnalytics
);
router.get(
  '/admin/revenue/summary',
  authorize('analytics.revenue.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getRevenueSummary
);
router.get(
  '/admin/revenue/charts',
  authorize('analytics.revenue.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getRevenueCharts
);
router.get(
  '/admin/users',
  authorize('analytics.users.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getUsersAnalytics
);
router.get(
  '/admin/users/summary',
  authorize('analytics.users.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getUsersSummary
);
router.get(
  '/admin/users/charts',
  authorize('analytics.users.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getUsersCharts
);
router.get(
  '/admin/listeners',
  authorize('analytics.listeners.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getListenersAnalytics
);
router.get(
  '/admin/listeners/summary',
  authorize('analytics.listeners.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getListenersSummary
);
router.get(
  '/admin/listeners/charts',
  authorize('analytics.listeners.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getListenersCharts
);
router.get(
  '/admin/sessions',
  authorize('analytics.sessions.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getSessionsAnalytics
);
router.get(
  '/admin/sessions/summary',
  authorize('analytics.sessions.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getSessionsSummary
);
router.get(
  '/admin/sessions/charts',
  authorize('analytics.sessions.view'),
  validate(adminAnalyticsQuerySchema),
  analyticsController.getSessionsCharts
);

export default router;
