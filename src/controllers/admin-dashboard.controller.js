import BaseController from './base.controller.js';
import catchAsync from '../utils/catchAsync.util.js';
import adminDashboardService from '../services/admin-dashboard.service.js';

class AdminDashboardController extends BaseController {
  getSummary = catchAsync(async (req, res) => {
    const data = await adminDashboardService.getSummary(req.query);
    this.sendResponse(res, 200, 'Admin dashboard summary fetched successfully', data);
  });

  getCharts = catchAsync(async (req, res) => {
    const data = await adminDashboardService.getCharts(req.query);
    this.sendResponse(res, 200, 'Admin dashboard charts fetched successfully', data);
  });

  getBusyListeners = catchAsync(async (req, res) => {
    const data = await adminDashboardService.getBusyListeners(req.query);
    this.sendResponse(res, 200, 'Busy listeners fetched successfully', data);
  });

  getChatSessions = catchAsync(async (req, res) => {
    const data = await adminDashboardService.getChatSessions(req.query);
    this.sendResponse(res, 200, 'Active chat sessions fetched successfully', data);
  });
}

export default new AdminDashboardController();
