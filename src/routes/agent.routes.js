import express from 'express';
import agentController from '../controllers/agent.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  agentRevenueSummaryQuerySchema,
  agentRevenueGraphsQuerySchema,
  agentRevenueHistoryQuerySchema,
} from '../validators/agent.validator.js';

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
 * GET /api/v1/agent/revenue/history
 * Paginated commission history table.
 */
router.get(
  '/revenue/history',
  validate(agentRevenueHistoryQuerySchema),
  agentController.getRevenueHistory
);

export default router;
