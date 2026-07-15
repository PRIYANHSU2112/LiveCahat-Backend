import BaseService from './base.service.js';
import chatMessageRepository from '../repositories/chat-message.repository.js';
import communicationSessionRepository from '../repositories/communication-session.repository.js';
import presenceService from './presence.service.js';
import redisClient from '../config/redis.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.util.js';
import xpService from './xp.service.js';

class ChatMessageService extends BaseService {
  constructor() {
    super(chatMessageRepository);
  }

  /**
   * Save a message to the database and update the Redis conversation cache.
   */
  
  async saveMessage(sessionId, senderId, text, messageType = 'TEXT', fileUrl = null) {
    try {
      const message = await this.repository.create({
        sessionId,
        senderId,
        text,
        messageType,
        fileUrl,
      });

      // Append to user pair conversation cache
      const session = await communicationSessionRepository.findById(sessionId);
      if (session) {
        const callerId = session.callerId.toString();
        const listenerId = session.listenerId.toString();
        const [userMin, userMax] = [callerId, listenerId].sort();
        const redisKey = `conversation:messages:${userMin}:${userMax}`;

        if (redisClient.isRedisAvailable) {
          const exists = await redisClient.exists(redisKey);
          if (exists) {
            const populatedMsg = await this.repository.model
              .findById(message._id)
              .populate('senderId', 'firstName lastName profilePicture')
              .lean();

            await redisClient.rpush(redisKey, JSON.stringify(populatedMsg));
            await redisClient.expire(redisKey, 86400); // 24 hours
          }
        }
      }

      // Fire-and-forget XP award for sending a chat message
      xpService.awardXp(senderId, 'CHAT_MESSAGE', { sessionId: sessionId.toString() }).catch(() => {});

      return message;
    } catch (err) {
      logger.error(`[ChatMessage Service] Failed to save message: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get paginated chat history for a session, returning all messages between the user pair.
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

    // Use user-pair conversation messages cache
    const [userMin, userMax] = [callerId, listenerId].sort();
    const redisKey = `conversation:messages:${userMin}:${userMax}`;

    let allMessages = [];

    if (redisClient.isRedisAvailable) {
      const exists = await redisClient.exists(redisKey);
      if (exists) {
        const cachedMsgStrs = await redisClient.lrange(redisKey, 0, -1);
        allMessages = cachedMsgStrs.map(str => JSON.parse(str));
      } else {
        allMessages = await this.loadAndCacheConversation(callerId, listenerId, redisKey);
      }
    } else {
      allMessages = await this.getConversationFromDB(callerId, listenerId);
    }

    const total = allMessages.length;
    const skip = (page - 1) * limit;
    const paginatedMessages = allMessages.slice(skip, skip + limit);

    return {
      messages: paginatedMessages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get list of all conversation threads (grouped by other participant) for a user.
   * @deprecated Prefer getConversations for production inbox UI.
   */
  async getUserChatSessions(userId, query = {}) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const skip = (page - 1) * limit;
    const userIdStr = userId.toString();
    const userObjectId = new mongoose.Types.ObjectId(userIdStr);

    // Group sessions by user pair (Caller ID & Listener ID) using aggregation:
    const aggregate = [
      {
        $match: {
          $or: [{ callerId: userObjectId }, { listenerId: userObjectId }],
          status: { $in: ['ONGOING', 'COMPLETED'] },
        }
      },
      {
        $sort: { updatedAt: -1 }
      },
      {
        $addFields: {
          otherUserId: {
            $cond: {
              if: { $eq: ['$callerId', userObjectId] },
              then: '$listenerId',
              else: '$callerId'
            }
          }
        }
      },
      {
        $group: {
          _id: '$otherUserId',
          latestSession: { $first: '$$ROOT' }
        }
      },
      {
        $sort: { 'latestSession.updatedAt': -1 }
      }
    ];

    // Count unique user pairs
    const countAggregate = [
      {
        $match: {
          $or: [{ callerId: userObjectId }, { listenerId: userObjectId }],
          status: { $in: ['ONGOING', 'COMPLETED'] },
        }
      },
      {
        $group: {
          _id: {
            $cond: {
              if: { $eq: ['$callerId', userObjectId] },
              then: '$listenerId',
              else: '$callerId'
            }
          }
        }
      },
      {
        $count: 'total'
      }
    ];

    const [results, countResult] = await Promise.all([
      communicationSessionRepository.model.aggregate([
        ...aggregate,
        { $skip: skip },
        { $limit: limit }
      ]),
      communicationSessionRepository.model.aggregate(countAggregate)
    ]);

    const total = countResult[0] ? countResult[0].total : 0;

    // Populate callerId and listenerId of latestSession
    await communicationSessionRepository.model.populate(results, [
      { path: 'latestSession.callerId', model: 'User', select: 'firstName lastName profilePicture' },
      { path: 'latestSession.listenerId', model: 'User', select: 'firstName lastName profilePicture' }
    ]);

    // Attach last message preview to each conversation
    const sessionsWithPreview = (await Promise.all(
      results.map(async (row) => {
        const session = row.latestSession;
        if (!session) return null;

        const lastMessage = await this.getLastMessageForUserPair(userId, row._id);
        const callerIdVal = session.callerId ? (session.callerId._id || session.callerId).toString() : null;
        const myRole = callerIdVal === userIdStr ? 'CALLER' : 'LISTENER';

        return {
          ...session,
          lastMessage: lastMessage
            ? {
              text: lastMessage.text,
              senderId: lastMessage.senderId,
              createdAt: lastMessage.createdAt,
            }
            : null,
          myRole,
        };
      })
    )).filter(Boolean);

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

  /**
   * Production inbox: conversations sorted by most recent message with search + pagination.
   */
  async getConversations(userId, query = {}) {
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 20;
    const search = query.search || '';

    const result = await this.repository.findConversationsForUser(userId, { page, limit, search });

    if (!result.conversations?.length) {
      return result;
    }

    const partnerIds = result.conversations.map((c) => c.user?.id?.toString()).filter(Boolean);
    const statusMap = await presenceService.getStatusBatch(partnerIds);
    const redisAvailable = redisClient.isRedisAvailable;

    result.conversations = result.conversations.map((conversation) => {
      const partnerId = conversation.user?.id?.toString();
      let status = statusMap.get(partnerId) || 'OFFLINE';

      if (!redisAvailable) {
        status = conversation.user?.isOnline ? 'ONLINE' : 'OFFLINE';
      }

      return {
        ...conversation,
        user: {
          ...conversation.user,
          status,
          isOnline: status !== 'OFFLINE',
        },
      };
    });

    return result;
  }

  /**
   * Helper to find the last message across all sessions for a user pair.
   */
  async getLastMessageForUserPair(userId1, userId2) {
    const [userMin, userMax] = [userId1.toString(), userId2.toString()].sort();
    const redisKey = `conversation:messages:${userMin}:${userMax}`;

    if (redisClient.isRedisAvailable) {
      const exists = await redisClient.exists(redisKey);
      if (exists) {
        const lastMsgArr = await redisClient.lrange(redisKey, -1, -1);
        if (lastMsgArr && lastMsgArr.length > 0) {
          return JSON.parse(lastMsgArr[0]);
        }
        return null;
      }
    }

    // Cache miss or Redis unavailable: DB Fallback
    const sessions = await communicationSessionRepository.model.find({
      $or: [
        { callerId: userId1, listenerId: userId2 },
        { callerId: userId2, listenerId: userId1 }
      ]
    }).select('_id');
    const sessionIds = sessions.map(s => s._id);

    const lastMessage = await chatMessageRepository.model
      .findOne({ sessionId: { $in: sessionIds } })
      .sort({ createdAt: -1 })
      .lean();

    return lastMessage;
  }

  /**
   * Helper to retrieve all conversation messages from MongoDB.
   */
  async getConversationFromDB(userId1, userId2) {
    const sessions = await communicationSessionRepository.model.find({
      $or: [
        { callerId: userId1, listenerId: userId2 },
        { callerId: userId2, listenerId: userId1 }
      ]
    }).select('_id');
    const sessionIds = sessions.map(s => s._id);

    return await chatMessageRepository.model
      .find({ sessionId: { $in: sessionIds } })
      .sort({ createdAt: 1 })
      .populate('senderId', 'firstName lastName profilePicture')
      .lean();
  }

  /**
   * Helper to load conversation messages from DB and cache them in Redis.
   */
  async loadAndCacheConversation(userId1, userId2, redisKey) {
    const messages = await this.getConversationFromDB(userId1, userId2);
    if (messages.length > 0) {
      const pipeline = redisClient.pipeline();
      messages.forEach(msg => {
        pipeline.rpush(redisKey, JSON.stringify(msg));
      });
      pipeline.expire(redisKey, 86400); // 24 hours
      await pipeline.exec();
    }
    return messages;
  }
}

export default new ChatMessageService();
