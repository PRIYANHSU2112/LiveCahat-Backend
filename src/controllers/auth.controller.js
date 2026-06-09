import BaseController from './base.controller.js';
import authService from '../services/auth.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class AuthController extends BaseController {
  
  requestOtp = catchAsync(async (req, res) => {
    const result = await authService.requestOtp(req.body);
    this.sendResponse(res, 200, result.message);
  });

  verifyOtp = catchAsync(async (req, res) => {
    const { token, user, isNewUser } = await authService.verifyOtp(req.body);
    this.sendResponse(res, 200, isNewUser ? 'User registered successfully' : 'Login successful', { token, user });
  });

  adminLogin = catchAsync(async (req, res) => {
    const { token, user } = await authService.adminLogin(req.body);
    this.sendResponse(res, 200, 'Admin login successful', { token, user });
  });
}

export default new AuthController();
