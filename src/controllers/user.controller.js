import BaseController from './base.controller.js';
import userService from '../services/user.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class UserController extends BaseController {

  // Get current user profile
  getMe = catchAsync(async (req, res) => {
    const user = await userService.getItemById(req.user._id);
    this.sendResponse(res, 200, 'Profile fetched successfully', user);
  });

  // Update current user profile
  updateMe = catchAsync(async (req, res) => {
    const updatedUser = await userService.updateProfile(req.user._id, req.body);
    this.sendResponse(res, 200, 'Profile updated successfully', updatedUser);
  });

  // Delete current user account (Soft delete)
  deleteMe = catchAsync(async (req, res) => {
    await userService.deleteUser(req.user._id);
    this.sendResponse(res, 200, 'Account deleted successfully');
  });

  // Get my settings/preference toggles
  getMySettings = catchAsync(async (req, res) => {
    const settings = await userService.getSettings(req.user._id);
    this.sendResponse(res, 200, 'Settings fetched successfully', settings);
  });

  // Update my settings (partial — only sent toggles change)
  updateMySettings = catchAsync(async (req, res) => {
    const settings = await userService.updateSettings(req.user._id, req.body);
    this.sendResponse(res, 200, 'Settings updated successfully', settings);
  });

  // --- ADMIN ONLY ROUTES below (handled by routes) ---

  getAllUsers = catchAsync(async (req, res) => {
    const result = await userService.getAllUsers(req.query);
    this.sendResponse(res, 200, 'Users fetched successfully', result);
  });

  getUserById = catchAsync(async (req, res) => {
    const user = await userService.getItemById(req.params.id);
    if (!user) return this.sendError(res, 404, 'User not found');
    this.sendResponse(res, 200, 'User fetched successfully', user);
  });

  blockUser = catchAsync(async (req, res) => {
    const user = await userService.blockUser(req.params.id, req.body);
    const action = req.body.isBlocked ? 'blocked' : 'unblocked';
    this.sendResponse(res, 200, `User ${action} successfully`, user);
  });

  createAdmin = catchAsync(async (req, res) => {
    const admin = await userService.createAdminUser(req.body);
    this.sendResponse(res, 201, 'Admin created successfully', admin);
  });

  createListener = catchAsync(async (req, res) => {
    const listener = await userService.createListenerUser(req.body);
    this.sendResponse(res, 201, 'Listener created successfully', listener);
  });

  createAgent = catchAsync(async (req, res) => {
    const agent = await userService.createAgentUser(req.body);
    this.sendResponse(res, 201, 'Agent created successfully', agent);
  });

  updateAgent = catchAsync(async (req, res) => {
    const agent = await userService.updateAgentUser(req.params.id, req.body);
    this.sendResponse(res, 200, 'Agent updated successfully', agent);
  });

  updateAgentCommission = catchAsync(async (req, res) => {
    const agent = await userService.updateAgentCommission(req.params.id, req.body.commissionPercentage);
    this.sendResponse(res, 200, 'Agent commission updated successfully', agent);
  });

  getCustomerStats = catchAsync(async (_req, res) => {
    const stats = await userService.getCustomerStats();
    this.sendResponse(res, 200, 'Customer stats fetched successfully', stats);
  });


  getCustomerActivityStats = catchAsync(async (_req, res) => {
    const stats = await userService.getCustomerActivityStats();
    this.sendResponse(res, 200, 'Customer activity stats fetched successfully', stats);
  });

  getCustomerActivityFeed = catchAsync(async (req, res) => {
    const result = await userService.getCustomerActivityFeed(req.query);
    this.sendResponse(res, 200, 'Customer activity feed fetched successfully', result);
  });

  getAgentAdminStats = catchAsync(async (req, res) => {
    const stats = await userService.getAgentAdminStats(req.query);
    this.sendResponse(res, 200, 'Agent stats fetched successfully', stats);
  });

  getBlockedAccountStats = catchAsync(async (_req, res) => {
    const stats = await userService.getBlockedAccountStats();
    this.sendResponse(res, 200, 'Blocked account stats fetched successfully', stats);
  });
}

export default new UserController();
