import BaseController from './base.controller.js';
import xpService from '../services/xp.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class XpController extends BaseController {
  // ─── User Endpoints ─────────────────────────────────────────────

  /**
   * GET /xp/profile — My XP profile (level, progress, next level)
   */
  getProfile = catchAsync(async (req, res) => {
    const data = await xpService.getUserXpProfile(req.user._id);
    this.sendResponse(res, 200, 'XP profile fetched successfully', data);
  });

  /**
   * GET /xp/history — Paginated personal XP transaction log
   */
  getHistory = catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const data = await xpService.getXpHistory(req.user._id, page, limit);
    this.sendResponse(res, 200, 'XP history fetched successfully', data);
  });

  /**
   * GET /xp/leaderboard — Top users by XP
   */
  getLeaderboard = catchAsync(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const data = await xpService.getLeaderboard(limit);
    this.sendResponse(res, 200, 'Leaderboard fetched successfully', data);
  });

  // ─── User: Reward Inventory Endpoints ───────────────────────────

  /**
   * GET /xp/rewards/inventory — My reward inventory (?status=UNCLAIMED|CLAIMED)
   */
  getRewardInventory = catchAsync(async (req, res) => {
    const data = await xpService.getRewardInventory(req.user._id, req.query.status);
    this.sendResponse(res, 200, 'Reward inventory fetched successfully', data);
  });

  /**
   * POST /xp/rewards/:inventoryId/claim — Claim a single reward
   */
  claimReward = catchAsync(async (req, res) => {
    const data = await xpService.claimReward(req.user._id, req.params.inventoryId);
    this.sendResponse(res, 200, 'Reward claimed successfully', data);
  });

  /**
   * POST /xp/rewards/claim-all — Claim all unclaimed rewards
   */
  claimAllRewards = catchAsync(async (req, res) => {
    const data = await xpService.claimAllRewards(req.user._id);
    this.sendResponse(res, 200, 'Rewards claimed successfully', data);
  });

  // ─── Admin: Stats & Audit ───────────────────────────────────────

  /**
   * GET /xp/admin/stats — Platform XP KPIs
   */
  getAdminStats = catchAsync(async (req, res) => {
    const data = await xpService.getAdminStats();
    this.sendResponse(res, 200, 'XP admin stats fetched successfully', data);
  });

  /**
   * GET /xp/admin/transactions — Paginated global XP ledger
   */
  listAdminTransactions = catchAsync(async (req, res) => {
    const data = await xpService.getAdminTransactions(req.query);
    this.sendResponse(res, 200, 'XP transactions fetched successfully', data);
  });

  /**
   * GET /xp/admin/reward-claims — Paginated reward claim audit
   */
  listAdminRewardClaims = catchAsync(async (req, res) => {
    const data = await xpService.getAdminRewardClaims(req.query);
    this.sendResponse(res, 200, 'XP reward claims fetched successfully', data);
  });

  // ─── Admin: Level Config Endpoints ──────────────────────────────

  /**
   * GET /xp/admin/level-configs — List all level configs (rewards populated)
   */
  listLevelConfigs = catchAsync(async (req, res) => {
    const data = await xpService.getAllLevelConfigs();
    this.sendResponse(res, 200, 'Level configs fetched successfully', data);
  });

  /**
   * POST /xp/admin/level-configs — Create a new level config
   */
  createLevelConfig = catchAsync(async (req, res) => {
    const data = await xpService.createLevelConfig(req.body);
    this.sendResponse(res, 201, 'Level config created successfully', data);
  });

  /**
   * PUT /xp/admin/level-configs/:id — Update a level config
   */
  updateLevelConfig = catchAsync(async (req, res) => {
    const data = await xpService.updateLevelConfig(req.params.id, req.body);
    this.sendResponse(res, 200, 'Level config updated successfully', data);
  });

  /**
   * DELETE /xp/admin/level-configs/:id — Delete a level config
   */
  deleteLevelConfig = catchAsync(async (req, res) => {
    const data = await xpService.deleteLevelConfig(req.params.id);
    this.sendResponse(res, 200, 'Level config deleted successfully', data);
  });

  // ─── Admin: Reward Endpoints ─────────────────────────────────────

  /**
   * GET /xp/admin/rewards — List all Reward docs
   */
  listRewards = catchAsync(async (req, res) => {
    const data = await xpService.getAllRewards();
    this.sendResponse(res, 200, 'Rewards fetched successfully', data);
  });

  /**
   * POST /xp/admin/rewards — Create a new reward doc
   */
  createReward = catchAsync(async (req, res) => {
    const data = await xpService.createReward(req.body);
    this.sendResponse(res, 201, 'Reward created successfully', data);
  });

  /**
   * PUT /xp/admin/rewards/:id — Update a reward doc
   */
  updateReward = catchAsync(async (req, res) => {
    const data = await xpService.updateReward(req.params.id, req.body);
    this.sendResponse(res, 200, 'Reward updated successfully', data);
  });

  /**
   * DELETE /xp/admin/rewards/:id — Delete a reward doc
   */
  deleteReward = catchAsync(async (req, res) => {
    const data = await xpService.deleteReward(req.params.id);
    this.sendResponse(res, 200, 'Reward deleted successfully', data);
  });

  // ─── Admin: XP Action Config Endpoints ──────────────────────────

  /**
   * GET /xp/admin/xp-actions — List all XP action configs
   */
  listXpActions = catchAsync(async (req, res) => {
    const data = await xpService.getAllXpActions();
    this.sendResponse(res, 200, 'XP action configs fetched successfully', data);
  });

  /**
   * PUT /xp/admin/xp-actions/:action — Update XP value / toggle active
   */
  updateXpAction = catchAsync(async (req, res) => {
    const data = await xpService.updateXpAction(req.params.action, req.body);
    this.sendResponse(res, 200, 'XP action config updated successfully', data);
  });

  // ─── Admin: Manual Grant ────────────────────────────────────────

  /**
   * POST /xp/admin/grant — Manually grant XP to any user
   */
  grantXp = catchAsync(async (req, res) => {
    const { userId, xpAmount, reason } = req.body;
    const data = await xpService.adminGrantXp(userId, xpAmount, reason);
    this.sendResponse(res, 200, 'XP granted successfully', data);
  });
}

export default new XpController();
