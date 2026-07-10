import BaseController from './base.controller.js';
import catchAsync from '../utils/catchAsync.util.js';
import adminAnalyticsService from '../services/admin-analytics.service.js';

class AnalyticsController extends BaseController {
  getRevenueSummary = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getRevenueSummary(req.query);
    this.sendResponse(res, 200, 'Revenue analytics summary fetched successfully', data);
  });

  getRevenueAnalytics = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getRevenueAnalytics(req.query);
    this.sendResponse(res, 200, 'Revenue analytics fetched successfully', data);
  });

  getRevenueCharts = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getRevenueCharts(req.query);
    this.sendResponse(res, 200, 'Revenue analytics charts fetched successfully', data);
  });

  getUsersSummary = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getUsersSummary(req.query);
    this.sendResponse(res, 200, 'User analytics summary fetched successfully', data);
  });

  getUsersAnalytics = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getUsersAnalytics(req.query);
    this.sendResponse(res, 200, 'User analytics fetched successfully', data);
  });

  getUsersCharts = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getUsersCharts(req.query);
    this.sendResponse(res, 200, 'User analytics charts fetched successfully', data);
  });

  getListenersSummary = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getListenersSummary(req.query);
    this.sendResponse(res, 200, 'Listener analytics summary fetched successfully', data);
  });

  getListenersAnalytics = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getListenersAnalytics(req.query);
    this.sendResponse(res, 200, 'Listener analytics fetched successfully', data);
  });

  getListenersCharts = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getListenersCharts(req.query);
    this.sendResponse(res, 200, 'Listener analytics charts fetched successfully', data);
  });

  getSessionsSummary = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getSessionsSummary(req.query);
    this.sendResponse(res, 200, 'Session analytics summary fetched successfully', data);
  });

  getSessionsAnalytics = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getSessionsAnalytics(req.query);
    this.sendResponse(res, 200, 'Session analytics fetched successfully', data);
  });

  getSessionsCharts = catchAsync(async (req, res) => {
    const data = await adminAnalyticsService.getSessionsCharts(req.query);
    this.sendResponse(res, 200, 'Session analytics charts fetched successfully', data);
  });
}

export default new AnalyticsController();
