import express from 'express';
import analyticsController from '../controllers/analytics.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { adminAnalyticsQuerySchema } from '../validators/admin-analytics.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get(
  '/admin/revenue',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getRevenueAnalytics
);
router.get(
  '/admin/revenue/summary',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getRevenueSummary
);
router.get(
  '/admin/revenue/charts',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getRevenueCharts
);
router.get(
  '/admin/users',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getUsersAnalytics
);
router.get(
  '/admin/users/summary',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getUsersSummary
);
router.get(
  '/admin/users/charts',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getUsersCharts
);
router.get(
  '/admin/listeners',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getListenersAnalytics
);
router.get(
  '/admin/listeners/summary',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getListenersSummary
);
router.get(
  '/admin/listeners/charts',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getListenersCharts
);
router.get(
  '/admin/sessions',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getSessionsAnalytics
);
router.get(
  '/admin/sessions/summary',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getSessionsSummary
);
router.get(
  '/admin/sessions/charts',
  validate(adminAnalyticsQuerySchema),
  analyticsController.getSessionsCharts
);

export default router;
