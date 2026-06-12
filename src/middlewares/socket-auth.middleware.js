import { verifyToken } from '../utils/jwt.util.js';
import User from '../modules/user.model.js';
import { getCache, setCache } from '../utils/redis.util.js';
import logger from '../utils/logger.util.js';

/**
 * Socket.io Handshake Authentication Middleware.
 * Validates JWT token from handshake auth or headers, loads user profile,
 * and attaches user object to the socket session.
 */
export const authenticateSocket = async (socket, next) => {
  try {
    let token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    if (!token) {
      return next(new Error('Authentication error: Token is required.'));
    }

    // Handle standard Bearer token header format
    if (token.startsWith('Bearer ')) {
      token = token.split(' ')[1];
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      return next(new Error('Authentication error: Invalid token structure.'));
    }

    const cacheKey = `auth:user:${decoded.id}`;
    let currentUser = await getCache(cacheKey);

    if (!currentUser) {
      currentUser = await User.findById(decoded.id).lean();
      if (currentUser) {
        await setCache(cacheKey, currentUser, 60); // Cache for 60 seconds
      }
    }

    if (!currentUser) {
      return next(new Error('Authentication error: User no longer exists.'));
    }

    if (currentUser.isDeleted) {
      return next(new Error('Authentication error: Your account has been deleted.'));
    }

    if (currentUser.isBlocked) {
      return next(new Error('Authentication error: Your account has been blocked by the admin.'));
    }

    // Attach user profile to socket object
    socket.user = {
      id: currentUser._id.toString(),
      _id: currentUser._id,
      type: currentUser.type,
      firstName: currentUser.firstName,
      lastName: currentUser.lastName,
      email: currentUser.email,
    };

    next();
  } catch (err) {
    logger.error(`[Socket Auth Error] Handshake rejection: ${err.message}`);
    if (err.name === 'TokenExpiredError') {
      return next(new Error('Authentication error: Token expired.'));
    }
    return next(new Error('Authentication error: Authentication failed.'));
  }
};
