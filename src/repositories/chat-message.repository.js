import mongoose from 'mongoose';
import BaseRepository from './base.repository.js';
import ChatMessage from '../modules/chat-message.model.js';
import communicationSessionRepository from './communication-session.repository.js';

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

  /**
   * Optimized conversation list for a user (single aggregation, no N+1).
   * Groups chat partners, attaches last message, unread count, and user profile.
   */
  async findConversationsForUser(userId, { page = 1, limit = 20, search = '' } = {}) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const skip = (page - 1) * limit;
    const searchTerm = (search || '').trim();
    const searchRegex = searchTerm ? new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

    const baseStages = [
      {
        $match: {
          $or: [{ callerId: userObjectId }, { listenerId: userObjectId }],
          status: { $in: ['ONGOING', 'COMPLETED'] },
        },
      },
      {
        $addFields: {
          otherUserId: {
            $cond: {
              if: { $eq: ['$callerId', userObjectId] },
              then: '$listenerId',
              else: '$callerId',
            },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          _id: '$otherUserId',
          sessionIds: { $addToSet: '$_id' },
          latestSessionId: { $first: '$_id' },
          lastSessionAt: { $max: '$updatedAt' },
        },
      },
      {
        $lookup: {
          from: 'chatmessages',
          let: { sids: '$sessionIds' },
          pipeline: [
            { $match: { $expr: { $in: ['$sessionId', '$$sids'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 1,
                text: 1,
                messageType: 1,
                senderId: 1,
                fileUrl: 1,
                createdAt: 1,
              },
            },
          ],
          as: 'lastMessageArr',
        },
      },
      {
        $lookup: {
          from: 'chatmessages',
          let: { sids: '$sessionIds', me: userObjectId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ['$sessionId', '$$sids'] },
                    { $ne: ['$senderId', '$$me'] },
                    { $eq: [{ $ifNull: ['$readAt', null] }, null] },
                  ],
                },
              },
            },
            { $count: 'count' },
          ],
          as: 'unreadArr',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            { $match: { isDeleted: { $ne: true } } },
            { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
          ],
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          lastMessage: { $arrayElemAt: ['$lastMessageArr', 0] },
          unreadCount: {
            $ifNull: [{ $arrayElemAt: ['$unreadArr.count', 0] }, 0],
          },
          fullName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$user.firstName', ''] },
                  ' ',
                  { $ifNull: ['$user.lastName', ''] },
                ],
              },
            },
          },
        },
      },
      // Only conversations that have at least one message
      { $match: { lastMessage: { $ne: null } } },
    ];

    if (searchRegex) {
      baseStages.push({
        $match: {
          $or: [
            { 'user.firstName': searchRegex },
            { 'user.lastName': searchRegex },
            { fullName: searchRegex },
          ],
        },
      });
    }

    baseStages.push(
      {
        $addFields: {
          lastMessageAt: { $ifNull: ['$lastMessage.createdAt', '$lastSessionAt'] },
        },
      },
      { $sort: { lastMessageAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                user: {
                  id: '$_id',
                  name: {
                    $cond: {
                      if: { $gt: [{ $strLenCP: '$fullName' }, 0] },
                      then: '$fullName',
                      else: 'User',
                    },
                  },
                  profilePicture: '$user.profileImage',
                  isOnline: { $ifNull: ['$user.isOnline', false] },
                },
                sessionId: '$latestSessionId',
                lastMessage: {
                  id: '$lastMessage._id',
                  text: '$lastMessage.text',
                  messageType: '$lastMessage.messageType',
                  senderId: '$lastMessage.senderId',
                  fileUrl: '$lastMessage.fileUrl',
                  createdAt: '$lastMessage.createdAt',
                },
                lastMessageAt: 1,
                unreadCount: 1,
              },
            },
          ],
        },
      }
    );

    const [result] = await communicationSessionRepository.model.aggregate(baseStages);
    const total = result?.metadata?.[0]?.total ?? 0;

    return {
      conversations: result?.data ?? [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }
}

export default new ChatMessageRepository();
