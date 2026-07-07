import BaseController from './base.controller.js';
import referralService from '../services/referral.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class ReferralController extends BaseController {
  // GET /referrals/details — code, link, stats for the Refer & Earn screen
  getReferralDetails = catchAsync(async (req, res) => {
    const data = await referralService.getReferralDetails(req.user._id);
    this.sendResponse(res, 200, 'Referral details fetched successfully', data);
  });

  // POST /referrals/apply — apply a referral code post-signup
  applyReferralCode = catchAsync(async (req, res) => {
    const data = await referralService.applyReferralCode(req.user._id, req.body.inviteCode);
    this.sendResponse(res, 200, 'Referral code applied — bonus credited!', data);
  });

  // ─── Admin ──────────────────────────────────────────────────────

  getReferralConfig = catchAsync(async (req, res) => {
    const data = await referralService.getReferralConfig();
    this.sendResponse(res, 200, 'Referral config fetched successfully', data);
  });

  updateReferralConfig = catchAsync(async (req, res) => {
    const data = await referralService.updateReferralConfig(req.body);
    this.sendResponse(res, 200, 'Referral config updated successfully', data);
  });

  getAdminStats = catchAsync(async (req, res) => {
    const data = await referralService.getAdminStats();
    this.sendResponse(res, 200, 'Referral stats fetched successfully', data);
  });

  getAdminReferrals = catchAsync(async (req, res) => {
    const data = await referralService.adminGetReferrals(req.query);
    this.sendResponse(res, 200, 'Referrals fetched successfully', data);
  });
}

export default new ReferralController();
