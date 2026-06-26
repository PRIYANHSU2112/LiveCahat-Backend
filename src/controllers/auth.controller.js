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

  login = catchAsync(async (req, res) => {
    const { token, user } = await authService.login(req.body);
    this.sendResponse(res, 200, 'Login successful', { token, user });
  });


  guestLogin = catchAsync(async (req, res) => {
    const { token, user, isNewUser } = await authService.guestLogin(req.body);
    this.sendResponse(res, 200, isNewUser ? 'Guest account created' : 'Welcome back', { token, user });
  });

  linkAccount = catchAsync(async (req, res) => {
    const { user } = await authService.linkAccount({ userId: req.user._id, ...req.body });
    this.sendResponse(res, 200, 'Phone number linked successfully', { user });
  });

  directLogin = catchAsync(async (req, res) => {
    const { token, user } = await authService.directLogin(req.body);
    this.sendResponse(res, 200, 'Magic link login successful', { token, user });
  });
}

export default new AuthController();
