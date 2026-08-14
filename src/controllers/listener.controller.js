import BaseController from './base.controller.js';
import listenerService from '../services/listener.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class ListenerController extends BaseController {

  getProfile = catchAsync(async (req, res) => {
    const profile = await listenerService.getProfile(req.user._id);
    this.sendResponse(res, 200, 'Listener profile fetched', profile);
  });

  updateProfile = catchAsync(async (req, res) => {
    const body = { ...req.body };

    // existingPhotos may arrive as JSON string when uploading gallery files
    if (typeof body.existingPhotos === 'string' && body.existingPhotos.trim()) {
      try {
        const parsed = JSON.parse(body.existingPhotos);
        if (Array.isArray(parsed) && !body.profilePhotos) {
          body.profilePhotos = parsed;
        } else if (Array.isArray(parsed) && Array.isArray(body.profilePhotos)) {
          body.profilePhotos = [...parsed, ...body.profilePhotos];
        }
      } catch {
        // ignore malformed JSON
      }
      delete body.existingPhotos;
    } else {
      delete body.existingPhotos;
    }

    // Multipart often sends single values as strings — normalize to arrays
    ['profilePhotos', 'interests', 'categories', 'languages'].forEach((key) => {
      if (typeof body[key] === 'string' && body[key].length) {
        body[key] = [body[key]];
      }
    });

    if (Array.isArray(body.profilePhotos)) {
      body.profilePhotos = body.profilePhotos
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter(Boolean)
        .slice(0, 9);
    }

    const profile = await listenerService.createOrUpdateProfile(req.user._id, body);
    this.sendResponse(res, 200, 'Listener profile updated', profile);
  });

  getPublicProfile = catchAsync(async (req, res) => {
    const profile = await listenerService.getPublicProfile(req.params.userId);
    this.sendResponse(res, 200, 'Public listener profile fetched', profile);
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

  getHostTasks = catchAsync(async (req, res) => {
    const data = await listenerService.getHostTasks(req.user._id);
    this.sendResponse(res, 200, 'Host tasks fetched successfully', data);
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

  getAdminListenerPerformance = catchAsync(async (req, res) => {
    const result = await listenerService.getAdminListenerPerformance(req.query);
    this.sendResponse(res, 200, 'Admin listener performance fetched successfully', result);
  });

  getAdminAvailabilityMonitoring = catchAsync(async (req, res) => {
    const result = await listenerService.getAdminAvailabilityMonitoring(req.query);
    this.sendResponse(res, 200, 'Admin availability monitoring fetched successfully', result);
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
