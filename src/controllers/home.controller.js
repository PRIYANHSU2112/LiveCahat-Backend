import BaseController from './base.controller.js';
import listenerService from '../services/listener.service.js';
import listenerHomeService from '../services/listener-home.service.js';
import catchAsync from '../utils/catchAsync.util.js';

/**
 * Home screen (customer/user section) controller.
 * Aggregates the data shown on the app home page. For now this exposes the
 * browsable list of active listeners with search, filters & pagination.
 */
class HomeController extends BaseController {
  getHomeListeners = catchAsync(async (req, res) => {
    const result = await listenerService.getHomeListeners(req.query);
    this.sendResponse(res, 200, 'Listeners fetched successfully', result);
  });

  getListenerHome = catchAsync(async (req, res) => {
    const result = await listenerHomeService.getListenerHome(req.user._id, req.query);
    this.sendResponse(res, 200, 'Listener home fetched successfully', result);
  });
}

export default new HomeController();
