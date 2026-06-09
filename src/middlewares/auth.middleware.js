import { verifyToken } from '../utils/jwt.util.js';
import ApiError from '../utils/ApiError.js';
import User from '../modules/user.model.js';
import catchAsync from '../utils/catchAsync.util.js';

/**
 * Middleware to protect routes via JWT
 */
export const authenticate = catchAsync(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw new ApiError(401, 'You are not logged in! Please log in to get access.');
  }

  try {
    const decoded = verifyToken(token);
    
    const currentUser = await User.findById(decoded.id).lean();
    if (!currentUser) {
      throw new ApiError(401, 'The user belonging to this token does no longer exist.');
    }

    if (currentUser.isDeleted) {
      throw new ApiError(401, 'Your account has been deleted.');
    }

    if (currentUser.isBlocked) {
      throw new ApiError(403, 'Your account has been blocked by the admin.');
    }

    req.user = currentUser;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Your token has expired! Please log in again.');
    }
    throw new ApiError(401, 'Invalid token! Please log in again.');
  }
});

/**
 * Middleware to restrict access to specific user types
 * @param  {...String} roles e.g. 'ADMIN', 'CUSTOMER', 'LISTENER'
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.type)) {
      return next(new ApiError(403, 'You do not have permission to perform this action'));
    }
    next();
  };
};
