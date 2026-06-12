import connectionHandler from '../handlers/connection.handler.js';
import chatRequestHandler from '../handlers/chat-request.handler.js';
import sessionHandler from '../handlers/session.handler.js';
import messageHandler from '../handlers/message.handler.js';

/**
 * Socket Events Binder.
 * Wires up socket events to their corresponding handlers.
 * Called inside the connection callback.
 * 
 * @param {Object} io - Socket.io Server instance
 * @param {Object} socket - Active client socket instance
 */
export const registerSocketEvents = (io, socket) => {
  // 1. Connection & Presence management (e.g. online, offline, reconnect)
  connectionHandler.handleConnection(io, socket);

  // 2. Chat Request/Accept flow
  chatRequestHandler.register(io, socket);

  // 3. Session Room operations
  sessionHandler.register(io, socket);

  // 4. Real-time Messaging & typing indicators
  messageHandler.register(io, socket);
};
