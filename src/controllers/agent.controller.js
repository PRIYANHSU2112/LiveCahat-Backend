import BaseController from './base.controller.js';
import agentService from '../services/agent.service.js';
import agentAnalyticsService from '../services/agent-analytics.service.js';
import agentSettlementService from '../services/agent-settlement.service.js';
import agentDashboardService from '../services/agent-dashboard.service.js';
import userReportService from '../services/user-report.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class AgentController extends BaseController {
  getRevenueSummary = catchAsync(async (req, res) => {
    const data = await agentService.getSummary(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent revenue summary fetched successfully', data);
  });

  getRevenueGraphs = catchAsync(async (req, res) => {
    const data = await agentService.getGraphs(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent revenue graphs fetched successfully', data);
  });

  getRevenueHistoryStats = catchAsync(async (req, res) => {
    const data = await agentService.getHistoryStats(req.user._id);
    this.sendResponse(res, 200, 'Agent commission history stats fetched successfully', data);
  });

  getRevenueHistory = catchAsync(async (req, res) => {
    const data = await agentService.getHistory(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent commission history fetched successfully', data);
  });

  getReports = catchAsync(async (req, res) => {
    const data = await userReportService.getAgentReports(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent reports fetched successfully', data);
  });

  getReportById = catchAsync(async (req, res) => {
    const data = await userReportService.getAgentReportById(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Report fetched successfully', data);
  });

  getAnalyticsRevenueSummary = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getRevenueSummary(req.user._id, req.query);
    this.sendResponse(res, 200, 'Revenue analytics summary fetched successfully', data);
  });

  getAnalyticsRevenueCharts = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getRevenueCharts(req.user._id, req.query);
    this.sendResponse(res, 200, 'Revenue analytics charts fetched successfully', data);
  });

  getAnalyticsListenersSummary = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getListenersSummary(req.user._id, req.query);
    this.sendResponse(res, 200, 'Listener analytics summary fetched successfully', data);
  });

  getAnalyticsListenersCharts = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getListenersCharts(req.user._id, req.query);
    this.sendResponse(res, 200, 'Listener analytics charts fetched successfully', data);
  });

  getAnalyticsRetentionSummary = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getRetentionSummary(req.user._id, req.query);
    this.sendResponse(res, 200, 'Retention analytics summary fetched successfully', data);
  });

  getAnalyticsRetentionCharts = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getRetentionCharts(req.user._id, req.query);
    this.sendResponse(res, 200, 'Retention analytics charts fetched successfully', data);
  });

  getAnalyticsPeriodReport = catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getPeriodReport(req.user._id, req.query);
    this.sendResponse(res, 200, 'Period report fetched successfully', data);
  });

  getDashboardSummary = catchAsync(async (req, res) => {
    const data = await agentDashboardService.getSummary(req.user._id, req.query);
    this.sendResponse(res, 200, 'Dashboard summary fetched successfully', data);
  });

  getDashboardCharts = catchAsync(async (req, res) => {
    const data = await agentDashboardService.getCharts(req.user._id, req.query);
    this.sendResponse(res, 200, 'Dashboard charts fetched successfully', data);
  });

  getDashboardActivity = catchAsync(async (req, res) => {
    const data = await agentDashboardService.getActivity(req.user._id, req.query);
    this.sendResponse(res, 200, 'Dashboard activity fetched successfully', data);
  });

  getSettlementStats = catchAsync(async (req, res) => {
    const data = await agentSettlementService.getStats(req.user._id);
    this.sendResponse(res, 200, 'Settlement stats fetched successfully', data);
  });

  getSettlements = catchAsync(async (req, res) => {
    const data = await agentSettlementService.getList(req.user._id, req.query);
    this.sendResponse(res, 200, 'Settlements fetched successfully', data);
  });

  getSettlementById = catchAsync(async (req, res) => {
    const data = await agentSettlementService.getById(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Settlement fetched successfully', data);
  });
}

export default new AgentController();
