import BaseRepository from './base.repository.js';
import ChatMessage from '../modules/chat-message.model.js';

class ChatMessageRepository extends BaseRepository {
  constructor() {
    super(ChatMessage);
  }

  /**
   * Fetch paginated messages for a session, sorted oldest → newest.
   */
  async findBySessionId(sessionId, { page = 1, limit = 50 } = {}) {
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.model
        .find({ sessionId })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate('senderId', 'firstName lastName profilePicture')
        .lean(),
      this.model.countDocuments({ sessionId }),
    ]);

    return {
      messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get last message of a session (for session list previews).
   */
  async findLastBySessionId(sessionId) {
    return await this.model
      .findOne({ sessionId })
      .sort({ createdAt: -1 })
      .populate('senderId', 'firstName lastName')
      .lean();
  }
}

export default new ChatMessageRepository();
