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

  // --- ADMIN ONLY ROUTES ---
  
  getAllListeners = catchAsync(async (req, res) => {
    const result = await listenerService.getAllListeners(req.query);
    this.sendResponse(res, 200, 'Listeners fetched successfully', result);
  });

  approveOrRejectListener = catchAsync(async (req, res) => {
    const profile = await listenerService.approveOrRejectListener(req.params.id, req.body);
    this.sendResponse(res, 200, `Listener KYC ${req.body.kycStatus.toLowerCase()} successfully`, profile);
  });
}

export default new ListenerController();
