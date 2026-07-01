import BaseController from './base.controller.js';
import withdrawalService from '../services/withdrawal.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class WithdrawalController extends BaseController {
  // ─── User ───────────────────────────────────────────────────────
  getConfig = catchAsync(async (req, res) => {
    const data = await withdrawalService.getConfig();
    this.sendResponse(res, 200, 'Withdrawal config fetched successfully', data);
  });

  quote = catchAsync(async (req, res) => {
    const data = await withdrawalService.quote(Number(req.query.coins));
    this.sendResponse(res, 200, 'Quote calculated successfully', data);
  });

  requestWithdrawal = catchAsync(async (req, res) => {
    const data = await withdrawalService.requestWithdrawal(req.user, req.body);
    this.sendResponse(res, 201, 'Withdrawal request submitted successfully', data);
  });

  getMyWithdrawals = catchAsync(async (req, res) => {
    const data = await withdrawalService.getMyWithdrawals(req.user._id, req.query);
    this.sendResponse(res, 200, 'Withdrawals fetched successfully', data);
  });

  getMyWithdrawalStats = catchAsync(async (req, res) => {
    const data = await withdrawalService.getMyWithdrawalStats(req.user._id, req.query.status);
    this.sendResponse(res, 200, 'Withdrawal stats fetched successfully', data);
  });

  getWithdrawalById = catchAsync(async (req, res) => {
    const data = await withdrawalService.getWithdrawalById(req.params.id, req.user);
    this.sendResponse(res, 200, 'Withdrawal fetched successfully', data);
  });

  cancelWithdrawal = catchAsync(async (req, res) => {
    const data = await withdrawalService.cancelWithdrawal(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Withdrawal cancelled and coins refunded', data);
  });

  // ─── Admin ──────────────────────────────────────────────────────
  updateConfig = catchAsync(async (req, res) => {
    const data = await withdrawalService.updateConfig(req.body);
    this.sendResponse(res, 200, 'Withdrawal config updated successfully', data);
  });

  adminListWithdrawals = catchAsync(async (req, res) => {
    const data = await withdrawalService.adminListWithdrawals(req.query);
    this.sendResponse(res, 200, 'Withdrawal requests fetched successfully', data);
  });

  adminApprove = catchAsync(async (req, res) => {
    const data = await withdrawalService.adminApprove(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Withdrawal approved successfully', data);
  });

  adminReject = catchAsync(async (req, res) => {
    const data = await withdrawalService.adminReject(req.user._id, req.params.id, req.body.reason);
    this.sendResponse(res, 200, 'Withdrawal rejected and coins refunded', data);
  });
}

export default new WithdrawalController();
