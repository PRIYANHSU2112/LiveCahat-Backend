import BaseController from './base.controller.js';
import authService from '../services/auth.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class AuthController extends BaseController {
  
  requestOtp = catchAsync(async (req, res) => {
    const result = await authService.requestOtp(req.body);
    this.sendResponse(res, 200, result.message);
  });

  verifyOtp = catchAsync(async (req, res) => {
    const { token, refreshToken, user, isNewUser } = await authService.verifyOtp(req.body);
    this.sendResponse(res, 200, isNewUser ? 'User registered successfully' : 'Login successful', { token, refreshToken, user });
  });

  login = catchAsync(async (req, res) => {
    const { token, refreshToken, user } = await authService.login(req.body);
    this.sendResponse(res, 200, 'Login successful', { token, refreshToken, user });
  });

  guestLogin = catchAsync(async (req, res) => {
    const { token, refreshToken, user, isNewUser } = await authService.guestLogin(req.body);
    this.sendResponse(res, 200, isNewUser ? 'Guest account created' : 'Welcome back', { token, refreshToken, user });
  });

  linkAccount = catchAsync(async (req, res) => {
    const { user } = await authService.linkAccount({ userId: req.user._id, ...req.body });
    this.sendResponse(res, 200, 'Phone number linked successfully', { user });
  });

  directLogin = catchAsync(async (req, res) => {
    const { token, refreshToken, user } = await authService.directLogin(req.body);
    this.sendResponse(res, 200, 'Magic link login successful', { token, refreshToken, user });
  });

  refreshToken = catchAsync(async (req, res) => {
    const result = await authService.refreshToken(req.body);
    this.sendResponse(res, 200, 'Token refreshed successfully', result);
  });

  logout = catchAsync(async (req, res) => {
    let userId = req.user?._id;
    const refreshToken = req.body?.refreshToken;

    // Route is public — recover userId from refresh JWT when Bearer is absent
    if (!userId && refreshToken) {
      try {
        const { verifyRefreshToken } = await import('../utils/jwt.util.js');
        const decoded = verifyRefreshToken(refreshToken);
        userId = decoded?.id;
      } catch {
        // ignore invalid refresh — still return success
      }
    }

    const result = await authService.logout({ userId, refreshToken });
    this.sendResponse(res, 200, result.message);
  });
}

export default new AuthController();
