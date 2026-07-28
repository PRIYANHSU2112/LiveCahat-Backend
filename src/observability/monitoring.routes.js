import express from 'express';
import monitoringController from './monitoring.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Apply auth middleware to protect monitoring APIs
router.use(authenticate);
router.use(restrictTo('ADMIN', 'SUPER_ADMIN'));

// 1. GET /api/v1/monitoring/metrics-summary
router.get('/metrics-summary', monitoringController.getMetricsSummary);

// 2. GET /api/v1/monitoring/service-health
router.get('/service-health', monitoringController.getServiceHealth);

// 3. GET /api/v1/monitoring/system-stats
router.get('/system-stats', monitoringController.getSystemStats);

// 4. GET /api/v1/monitoring/traces
router.get('/traces', monitoringController.getRecentTraces);

// 5. GET /api/v1/monitoring/alerts
router.get('/alerts', monitoringController.getAlertsData);

// 6. GET /api/v1/monitoring/logs
router.get('/logs', monitoringController.getRecentLogs);

// 7. GET /api/v1/monitoring/api-routes
router.get('/api-routes', monitoringController.getApiRoutesBreakdown);

// 8. GET /api/v1/monitoring/performance
router.get('/performance', monitoringController.getPerformanceMetrics);

export default router;
