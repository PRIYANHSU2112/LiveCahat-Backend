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
   * Optimized conversation list for a user (single aggregation on ChatMessage).
   * Groups chat partners, attaches true latest message, accurate unread count, and user profile.
   */
  async findConversationsForUser(userId, { page = 1, limit = 20, search = '' } = {}) {
    const userIdStr = userId ? userId.toString() : '';
    const userObjectId = mongoose.Types.ObjectId.isValid(userIdStr) ? new mongoose.Types.ObjectId(userIdStr) : null;
    const matchUserIds = userObjectId ? [userObjectId, userIdStr] : [userIdStr];
    const skip = (page - 1) * limit;
    const searchTerm = (search || '').trim();
    const searchRegex = searchTerm ? new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

    const baseStages = [
      {
        $match: {
          $or: [
            { senderId: { $in: matchUserIds } },
            { recipientId: { $in: matchUserIds } },
          ],
          deletedAt: null,
        },
      },
      {
        $addFields: {
          partnerId: {
            $cond: {
              if: {
                $or: [
                  { $eq: ['$senderId', userObjectId] },
                  { $eq: [{ $toString: '$senderId' }, userIdStr] },
                ],
              },
              then: '$recipientId',
              else: '$senderId',
            },
          },
        },
      },
      {
        $match: {
          partnerId: { $ne: null, $exists: true },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$partnerId',
          lastMessage: { $first: '$$ROOT' },
          lastMessageAt: { $first: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    {
                      $or: [
                        { $eq: ['$recipientId', userObjectId] },
                        { $eq: [{ $toString: '$recipientId' }, userIdStr] },
                      ],
                    },
                    { $eq: [{ $ifNull: ['$readAt', null] }, null] },
                  ],
                },
                then: 1,
                else: 0,
              },
            },
          },
        },
      },
      {
        $addFields: {
          partnerObjectId: {
            $convert: { input: '$_id', to: 'objectId', onError: '$_id', onNull: '$_id' },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          let: { pObj: '$partnerObjectId', pRaw: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ['$isDeleted', true] },
                    {
                      $or: [
                        { $eq: ['$_id', '$$pObj'] },
                        { $eq: [{ $toString: '$_id' }, { $toString: '$$pRaw' }] },
                      ],
                    },
                  ],
                },
              },
            },
            { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
          ],
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
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
                      if: { $gt: [{ $strLenCP: { $ifNull: ['$fullName', ''] } }, 0] },
                      then: '$fullName',
                      else: 'User',
                    },
                  },
                  profilePicture: '$user.profileImage',
                  isOnline: { $ifNull: ['$user.isOnline', false] },
                },
                sessionId: { $ifNull: ['$lastMessage.sessionId', '$_id'] },
                lastMessage: {
                  id: '$lastMessage._id',
                  text: '$lastMessage.text',
                  messageType: '$lastMessage.messageType',
                  senderId: '$lastMessage.senderId',
                  fileUrl: '$lastMessage.fileUrl',
                  createdAt: '$lastMessage.createdAt',
                },
                lastMessageAt: '$lastMessageAt',
                unreadCount: '$unreadCount',
              },
            },
          ],
        },
      }
    );

    const [result] = await this.model.aggregate(baseStages);
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
