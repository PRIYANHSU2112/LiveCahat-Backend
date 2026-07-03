import express from 'express';
import agentController from '../controllers/agent.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  agentRevenueSummaryQuerySchema,
  agentRevenueGraphsQuerySchema,
  agentRevenueHistoryQuerySchema,
  agentRevenueHistoryStatsQuerySchema,
} from '../validators/agent.validator.js';
import {
  agentAnalyticsRevenueQuerySchema,
  agentAnalyticsListenersQuerySchema,
  agentAnalyticsRetentionQuerySchema,
  agentAnalyticsPeriodReportQuerySchema,
} from '../validators/agent-analytics.validator.js';
import {
  agentDashboardPeriodQuerySchema,
  agentDashboardActivityQuerySchema,
} from '../validators/agent-dashboard.validator.js';
import { idParamSchema, listReportsQuerySchema } from '../validators/report.validator.js';
import {
  listAgentSettlementsQuerySchema,
  runSettlementsSchema,
} from '../validators/agent-settlement.validator.js';

const router = express.Router();

router.use(authenticate);
router.use(restrictTo('AGENT'));

/**
 * GET /api/v1/agent/revenue/summary
 * KPI cards for the agent revenue dashboard.
 */
router.get(
  '/revenue/summary',
  validate(agentRevenueSummaryQuerySchema),
  agentController.getRevenueSummary
);

/**
 * GET /api/v1/agent/revenue/graphs
 * Monthly comparison, weekly commission trend, and source breakdown.
 */
router.get(
  '/revenue/graphs',
  validate(agentRevenueGraphsQuerySchema),
  agentController.getRevenueGraphs
);

/**
 * GET /api/v1/agent/revenue/history/stats
 * KPI strip for commission history (total / paid / pending / avg rate).
 */
router.get(
  '/revenue/history/stats',
  validate(agentRevenueHistoryStatsQuerySchema),
  agentController.getRevenueHistoryStats
);


/**
 * GET /api/v1/agent/revenue/history
 * Paginated commission history table.
 */

router.get(
  '/revenue/history',
  validate(agentRevenueHistoryQuerySchema),
  agentController.getRevenueHistory
);

/**
 * GET /api/v1/agent/reports — read-only listener report inbox.
 */
router.get(
  '/reports',
  validate(listReportsQuerySchema),
  agentController.getReports
);

router.get(
  '/reports/:id',
  validate(idParamSchema),
  agentController.getReportById
);

/**
 * GET /api/v1/agent/analytics/revenue/summary — revenue analytics KPI cards.
 */
router.get(
  '/analytics/revenue/summary',
  validate(agentAnalyticsRevenueQuerySchema),
  agentController.getAnalyticsRevenueSummary
);

/**
 * GET /api/v1/agent/analytics/revenue/charts — revenue by source chart + breakdown.
 */
router.get(
  '/analytics/revenue/charts',
  validate(agentAnalyticsRevenueQuerySchema),
  agentController.getAnalyticsRevenueCharts
);

/**
 * GET /api/v1/agent/analytics/listeners/summary — listener analytics KPI cards.
 */
router.get(
  '/analytics/listeners/summary',
  validate(agentAnalyticsListenersQuerySchema),
  agentController.getAnalyticsListenersSummary
);

/**
 * GET /api/v1/agent/analytics/listeners/charts — listener growth chart.
 */
router.get(
  '/analytics/listeners/charts',
  validate(agentAnalyticsListenersQuerySchema),
  agentController.getAnalyticsListenersCharts
);

/**
 * GET /api/v1/agent/analytics/retention/summary — retention KPI cards.
 */
router.get(
  '/analytics/retention/summary',
  validate(agentAnalyticsRetentionQuerySchema),
  agentController.getAnalyticsRetentionSummary
);

/**
 * GET /api/v1/agent/analytics/retention/charts — retention curve chart.
 */
router.get(
  '/analytics/retention/charts',
  validate(agentAnalyticsRetentionQuerySchema),
  agentController.getAnalyticsRetentionCharts
);

/**
 * GET /api/v1/agent/analytics/period-reports — daily/weekly/monthly revenue report.
 */
router.get(
  '/analytics/period-reports',
  validate(agentAnalyticsPeriodReportQuerySchema),
  agentController.getAnalyticsPeriodReport
);

/**
 * GET /api/v1/agent/dashboard/summary — KPI cards with period-over-period trends.
 */
router.get(
  '/dashboard/summary',
  validate(agentDashboardPeriodQuerySchema),
  agentController.getDashboardSummary
);

/**
 * GET /api/v1/agent/dashboard/charts — dashboard chart series.
 */
router.get(
  '/dashboard/charts',
  validate(agentDashboardPeriodQuerySchema),
  agentController.getDashboardCharts
);

/**
 * GET /api/v1/agent/dashboard/activity — recent activity feed.
 */
router.get(
  '/dashboard/activity',
  validate(agentDashboardActivityQuerySchema),
  agentController.getDashboardActivity
);

/**
 * GET /api/v1/agent/settlements/stats — settlement KPI cards.
 */
router.get('/settlements/stats', agentController.getSettlementStats);

/**
 * GET /api/v1/agent/settlements — paginated settlement history.
 */
router.get(
  '/settlements',
  validate(listAgentSettlementsQuerySchema),
  agentController.getSettlements
);

/**
 * GET /api/v1/agent/settlements/:id — single settlement detail.
 */
router.get(
  '/settlements/:id',
  validate(idParamSchema),
  agentController.getSettlementById
);

export default router;
