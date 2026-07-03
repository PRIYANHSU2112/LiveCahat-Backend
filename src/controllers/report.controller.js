import BaseController from './base.controller.js';
import reportReasonService from '../services/report-reason.service.js';
import userReportService from '../services/user-report.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class ReportController extends BaseController {
  getActiveReasons = catchAsync(async (_req, res) => {
    const data = await reportReasonService.getActiveReasons();
    this.sendResponse(res, 200, 'Report reasons fetched successfully', data);
  });

  getAllReasons = catchAsync(async (req, res) => {
    const data = await reportReasonService.getAllReasons(req.query);
    this.sendResponse(res, 200, 'Report reasons fetched successfully', data);
  });

  createReason = catchAsync(async (req, res) => {
    const data = await reportReasonService.createReason(req.user._id, req.body);
    this.sendResponse(res, 201, 'Report reason created successfully', data);
  });

  updateReason = catchAsync(async (req, res) => {
    const data = await reportReasonService.updateReason(req.params.id, req.body);
    this.sendResponse(res, 200, 'Report reason updated successfully', data);
  });

  toggleReason = catchAsync(async (req, res) => {
    const data = await reportReasonService.toggleReason(req.params.id, req.body?.isActive);
    this.sendResponse(res, 200, 'Report reason status updated successfully', data);
  });

  deleteReason = catchAsync(async (req, res) => {
    const data = await reportReasonService.deleteReason(req.params.id);
    this.sendResponse(res, 200, 'Report reason deleted successfully', data);
  });

  createReport = catchAsync(async (req, res) => {
    const data = await userReportService.createReport(req.user, req.body);
    this.sendResponse(res, 201, 'Report submitted successfully', data);
  });

  getMyReports = catchAsync(async (req, res) => {
    const data = await userReportService.getMyReports(req.user._id, req.query);
    this.sendResponse(res, 200, 'Reports fetched successfully', data);
  });

  getMyReportById = catchAsync(async (req, res) => {
    const data = await userReportService.getReportForUser(req.params.id, req.user);
    this.sendResponse(res, 200, 'Report fetched successfully', data);
  });

  getAllReports = catchAsync(async (req, res) => {
    const data = await userReportService.getAllReports(req.query);
    this.sendResponse(res, 200, 'Reports fetched successfully', data);
  });

  getStats = catchAsync(async (_req, res) => {
    const data = await userReportService.getStats();
    this.sendResponse(res, 200, 'Report stats fetched successfully', data);
  });

  getReportById = catchAsync(async (req, res) => {
    const data = await userReportService.getReportById(req.params.id);
    this.sendResponse(res, 200, 'Report fetched successfully', data);
  });

  moderateReport = catchAsync(async (req, res) => {
    const data = await userReportService.moderateReport(req.params.id, req.user, req.body);
    this.sendResponse(res, 200, 'Report moderated successfully', data);
  });
}

export default new ReportController();
