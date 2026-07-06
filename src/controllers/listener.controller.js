import BaseController from './base.controller.js';
import listenerService from '../services/listener.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class ListenerController extends BaseController {

  getProfile = catchAsync(async (req, res) => {
    const profile = await listenerService.getProfile(req.user._id);
    this.sendResponse(res, 200, 'Listener profile fetched', profile);
  });

  updateProfile = catchAsync(async (req, res) => {
    const profile = await listenerService.createOrUpdateProfile(req.user._id, req.body);
    this.sendResponse(res, 200, 'Listener profile updated', profile);
  });

  submitKyc = catchAsync(async (req, res) => {
    const profile = await listenerService.submitKyc(req.user._id, req.body);
    this.sendResponse(res, 200, 'KYC submitted successfully', profile);
  });

  updateRates = catchAsync(async (req, res) => {
    const profile = await listenerService.createOrUpdateProfile(req.user._id, req.body);
    this.sendResponse(res, 200, 'Rates updated successfully', profile);
  });

  updateAvailability = catchAsync(async (req, res) => {
    const profile = await listenerService.createOrUpdateProfile(req.user._id, req.body);
    this.sendResponse(res, 200, 'Availability updated', profile);
  });

  toggleAvailability = catchAsync(async (req, res) => {
    const profile = await listenerService.toggleAvailability(req.user._id);
    this.sendResponse(res, 200, `You are now ${profile.availability}`, profile);
  });

  // --- DASHBOARD (LISTENER) ---

  getDashboard = catchAsync(async (req, res) => {
    const data = await listenerService.getDashboard(req.user._id);
    this.sendResponse(res, 200, 'Dashboard fetched successfully', data);
  });

  getDashboardOverview = catchAsync(async (req, res) => {
    const data = await listenerService.getDashboardOverview(req.user._id, req.query.period);
    this.sendResponse(res, 200, 'Dashboard overview fetched successfully', data);
  });

  getRecentSessions = catchAsync(async (req, res) => {
    const data = await listenerService.getRecentSessions(req.user._id, req.query);
    this.sendResponse(res, 200, 'Recent sessions fetched successfully', data);
  });

  // --- ADMIN ONLY ROUTES ---

  getAllListeners = catchAsync(async (req, res) => {
    const result = await listenerService.getAllListeners(req.query);
    this.sendResponse(res, 200, 'Listeners fetched successfully', result);
  });

  approveOrRejectListener = catchAsync(async (req, res) => {
    const profile = await listenerService.approveOrRejectListener(req.params.id, req.body);
    this.sendResponse(res, 200, `Listener KYC ${req.body.kycStatus.toLowerCase()} successfully`, profile);
  });

  createListener = catchAsync(async (req, res) => {
    const result = await listenerService.createListenerByAgent(req.user._id, req.body);
    this.sendResponse(res, 201, 'Listener created successfully', result);
  });

  getAgentListeners = catchAsync(async (req, res) => {
    const result = await listenerService.getAgentListeners(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent listeners fetched successfully', result);
  });

  getAgentStats = catchAsync(async (req, res) => {
    const result = await listenerService.getAgentStats(req.user._id);
    this.sendResponse(res, 200, 'Agent stats fetched successfully', result);
  });
  getAdminStats = catchAsync(async (req, res) => {
    const stats = await listenerService.getAdminStats();
    this.sendResponse(res, 200, 'Admin listener stats fetched successfully', stats);
  });

  getListenerById = catchAsync(async (req, res) => {
    const listener = await listenerService.getListenerByIdForAdmin(req.params.id);
    this.sendResponse(res, 200, 'Listener details fetched successfully', listener);
  });

  updateListenerByAdmin = catchAsync(async (req, res) => {
    const listener = await listenerService.updateListenerByAdmin(req.params.id, req.body);
    this.sendResponse(res, 200, 'Listener details updated successfully', listener);
  });
}

export default new ListenerController();
