import jwt from 'jsonwebtoken';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.util.js';
import { HTTP_STATUS } from '../constants/responseCodes.constant.js';

/**
 * Global HTTP Authentication Middleware
 */
export const requireAuth = catchAsync(async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'You are not logged in! Please log in to get access.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    
    // In production, fetch user from DB here to ensure they still exist/are active.
    req.user = decoded;
    next();
  } catch (err) {
    return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid or expired token.'));
  }
});
