import catchAsync from '../utils/catchAsync.util.js';
import adminExportService from '../services/admin-export.service.js';

class AdminExportController {
  exportUsers = catchAsync(async (req, res) => {
    await adminExportService.exportUsers(req.query, res);
  });

  exportListeners = catchAsync(async (req, res) => {
    await adminExportService.exportListeners(req.query, res);
  });

  exportCoinTransactions = catchAsync(async (req, res) => {
    await adminExportService.exportCoinTransactions(req.query, res);
  });

  exportPaymentTransactions = catchAsync(async (req, res) => {
    await adminExportService.exportPaymentTransactions(req.query, res);
  });

  exportWithdrawals = catchAsync(async (req, res) => {
    await adminExportService.exportWithdrawals(req.query, res);
  });

  exportReports = catchAsync(async (req, res) => {
    await adminExportService.exportReports(req.query, res);
  });

  exportAuditLogs = catchAsync(async (req, res) => {
    await adminExportService.exportAuditLogs(req.query, res);
  });

  exportSessions = catchAsync(async (req, res) => {
    await adminExportService.exportSessions(req.query, res);
  });

  exportRoles = catchAsync(async (req, res) => {
    await adminExportService.exportRoles(req.query, res);
  });

  exportCountries = catchAsync(async (req, res) => {
    await adminExportService.exportCountries(req.query, res);
  });

  exportLanguages = catchAsync(async (req, res) => {
    await adminExportService.exportLanguages(req.query, res);
  });

  exportGifts = catchAsync(async (req, res) => {
    await adminExportService.exportGifts(req.query, res);
  });

  exportCoinPacks = catchAsync(async (req, res) => {
    await adminExportService.exportCoinPacks(req.query, res);
  });

  exportBanners = catchAsync(async (req, res) => {
    await adminExportService.exportBanners(req.query, res);
  });

  exportAvatars = catchAsync(async (req, res) => {
    await adminExportService.exportAvatars(req.query, res);
  });

  exportStickers = catchAsync(async (req, res) => {
    await adminExportService.exportStickers(req.query, res);
  });

  exportReferrals = catchAsync(async (req, res) => {
    await adminExportService.exportReferrals(req.query, res);
  });

  exportFeedback = catchAsync(async (req, res) => {
    await adminExportService.exportFeedback(req.query, res);
  });

  exportUserActivity = catchAsync(async (req, res) => {
    await adminExportService.exportUserActivity(req.query, res);
  });
}

export default new AdminExportController();
