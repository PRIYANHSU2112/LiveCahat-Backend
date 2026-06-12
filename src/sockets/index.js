import { authenticateSocket } from '../middlewares/socket-auth.middleware.js';
import { registerSocketEvents } from '../events/socket.events.js';
import { setSocketIo } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';

/**
 * Bootstraps the Socket.io server.
 * Applies authentications, registers events, and stores instance reference.
 * 
 * @param {Object} io - Socket.io Server instance
 */
export const initializeSockets = (io) => {
  // Store global socket instance reference
  setSocketIo(io);

  // Apply authorization middleware to verify handshakes
  io.use(authenticateSocket);

  // Set up connection event listener
  io.on('connection', (socket) => {
    try {
      // Wire up all modular event handlers
      registerSocketEvents(io, socket);
    } catch (err) {
      logger.error(`[Socket Connection Init Error] Socket ID: ${socket.id}, User: ${socket.user?.id}: ${err.message}`);
      socket.emit('socket_error', { message: 'Initialization failed.' });
      socket.disconnect(true);
    }
  });

  logger.info('Modular socket architecture initialized.');
};
