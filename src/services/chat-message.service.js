import BaseService from './base.service.js';
import chatMessageRepository from '../repositories/chat-message.repository.js';
import communicationSessionRepository from '../repositories/communication-session.repository.js';
import logger from '../utils/logger.util.js';

class ChatMessageService extends BaseService {
  constructor() {
    super(chatMessageRepository);
  }

  /**
   * Save a message to the database.
   */
  async saveMessage(sessionId, senderId, text, messageType = 'TEXT') {
    try {
      return await this.repository.create({
        sessionId,
        senderId,
        text,
        messageType,
      });
    } catch (err) {
      logger.error(`[ChatMessage Service] Failed to save message: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get paginated chat history for a session.
   * Verifies the requesting user is a participant.
   */
  async getSessionMessages(sessionId, userId, query = {}) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;

    // Verify the user is a participant of this session
    const session = await communicationSessionRepository.findById(sessionId);
    if (!session) {
      const error = new Error('Session not found.');
      error.statusCode = 404;
      throw error;
    }

    const callerId = session.callerId.toString();
    const listenerId = session.listenerId.toString();
    const userIdStr = userId.toString();

    if (userIdStr !== callerId && userIdStr !== listenerId) {
      const error = new Error('Unauthorized: You are not a participant of this session.');
      error.statusCode = 403;
      throw error;
    }

    return await this.repository.findBySessionId(sessionId, { page, limit });
  }

  /**
   * Get list of all sessions (with last message preview) for a user.
   */
  async getUserChatSessions(userId, query = {}) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const skip = (page - 1) * limit;
    const userIdStr = userId.toString();

    // Find all sessions where user is either caller or listener
    const filter = {
      $or: [{ callerId: userId }, { listenerId: userId }],
      status: { $in: ['ONGOING', 'COMPLETED'] },
    };

    const [sessions, total] = await Promise.all([
      communicationSessionRepository.model
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('callerId', 'firstName lastName profilePicture')
        .populate('listenerId', 'firstName lastName profilePicture')
        .lean(),
      communicationSessionRepository.model.countDocuments(filter),
    ]);

    // Attach last message preview to each session
    const sessionsWithPreview = await Promise.all(
      sessions.map(async (session) => {
        const lastMessage = await this.repository.findLastBySessionId(session._id);
        return {
          ...session,
          lastMessage: lastMessage
            ? {
                text: lastMessage.text,
                senderId: lastMessage.senderId,
                createdAt: lastMessage.createdAt,
              }
            : null,
          // Add which role the current user plays
          myRole: session.callerId._id.toString() === userIdStr ? 'CALLER' : 'LISTENER',
        };
      })
    );

    return {
      sessions: sessionsWithPreview,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export default new ChatMessageService();
