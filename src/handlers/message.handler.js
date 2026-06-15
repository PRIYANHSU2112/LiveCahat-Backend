import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import communicationSessionService from '../services/communication-session.service.js';
import chatMessageService from '../services/chat-message.service.js';
import { emitToSession } from '../utils/socket-room.util.js';
import logger from '../utils/logger.util.js';

class MessageHandler {
  /**
   * Register event listeners for real-time messaging.
   */
  register(io, socket) {
    socket.on(CLIENT_EVENTS.SEND_MESSAGE, (data) => this.sendMessage(io, socket, data));
    socket.on(CLIENT_EVENTS.TYPING, (data) => this.handleTyping(io, socket, data));
  }

  /**
   * Sends a message to the active session room and persists it to DB.
   */
  async sendMessage(io, socket, data) {
    const senderId = socket.user.id;
    const { sessionId, text } = data;

    try {
      if (!sessionId || !text) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session ID and text are required.' });
      }

      // Check if user is in this active session
      const activeSessionId = await communicationSessionService.getActiveSessionForUser(senderId);
      if (!activeSessionId || activeSessionId !== sessionId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are not in an active session with this ID.' });
      }

      const timestamp = new Date();

      // Persist message to MongoDB (fire-and-forget to not block real-time delivery)
      chatMessageService.saveMessage(sessionId, senderId, text).catch((err) => {
        logger.error(`[Socket Message Persist Error] Session ${sessionId}: ${err.message}`);
      });

      // Broadcast message to the session room, excluding the sender
      socket.to(`session:${sessionId}`).emit(SERVER_EVENTS.RECEIVE_MESSAGE, {
        senderId,
        message: text,
        messageType: 'TEXT',
        fileUrl: null,
        timestamp,
      });

      logger.info(`[Socket Message] Message forwarded in session ${sessionId} from ${senderId}`);
    } catch (err) {
      logger.error(`[Socket Message Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to send message.' });
    }
  }

  /**
   * Forwards typing indicators (typing status) to other participants.
   */
  async handleTyping(io, socket, data) {
    const userId = socket.user.id;
    const { sessionId, isTyping } = data;

    try {
      if (!sessionId) return;

      // Broadcast typing indicator to the other room member
      socket.to(`session:${sessionId}`).emit(SERVER_EVENTS.DISPLAY_TYPING, {
        userId,
        isTyping: !!isTyping,
      });
    } catch (err) {
      logger.error(`[Socket Typing Error] ${err.message}`);
    }
  }


}

export default new MessageHandler();

