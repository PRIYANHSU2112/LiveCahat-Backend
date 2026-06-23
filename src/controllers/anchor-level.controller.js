import BaseController from './base.controller.js';
import anchorLevelService from '../services/anchor-level.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class AnchorLevelController extends BaseController {
  // ─── Shared ─────────────────────────────────────────────────────
  getLadder = catchAsync(async (req, res) => {
    const data = await anchorLevelService.getActiveLevels();
    this.sendResponse(res, 200, 'Anchor levels fetched successfully', data);
  });

  // ─── Listener ───────────────────────────────────────────────────
  getMyStatus = catchAsync(async (req, res) => {
    const data = await anchorLevelService.getMyAnchorStatus(req.user._id);
    this.sendResponse(res, 200, 'Anchor status fetched successfully', data);
  });

  getRewardInventory = catchAsync(async (req, res) => {
    const data = await anchorLevelService.getRewardInventory(req.user._id, req.query.status);
    this.sendResponse(res, 200, 'Reward inventory fetched successfully', data);
  });

  claimReward = catchAsync(async (req, res) => {
    const data = await anchorLevelService.claimReward(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Reward claimed successfully', data);
  });

  claimAllRewards = catchAsync(async (req, res) => {
    const data = await anchorLevelService.claimAllRewards(req.user._id);
    this.sendResponse(res, 200, 'Rewards claimed successfully', data);
  });

  // ─── Admin ──────────────────────────────────────────────────────
  getAllLevels = catchAsync(async (req, res) => {
    const data = await anchorLevelService.getAllLevels();
    this.sendResponse(res, 200, 'Anchor levels fetched successfully', data);
  });

  createLevel = catchAsync(async (req, res) => {
    const data = await anchorLevelService.createLevel(req.body);
    this.sendResponse(res, 201, 'Anchor level created successfully', data);
  });

  updateLevel = catchAsync(async (req, res) => {
    const data = await anchorLevelService.updateLevel(req.params.id, req.body);
    this.sendResponse(res, 200, 'Anchor level updated successfully', data);
  });

  deleteLevel = catchAsync(async (req, res) => {
    await anchorLevelService.deleteLevel(req.params.id);
    this.sendResponse(res, 200, 'Anchor level deleted successfully');
  });

  getClaims = catchAsync(async (req, res) => {
    const data = await anchorLevelService.adminGetClaims(req.query);
    this.sendResponse(res, 200, 'Reward claims fetched successfully', data);
  });
}

export default new AnchorLevelController();
