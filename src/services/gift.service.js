import mongoose from 'mongoose';
import giftRepository from '../repositories/gift.repository.js';
import giftTransactionRepository from '../repositories/gift-transaction.repository.js';
import userRepository from '../repositories/user.repository.js';
import Wallet from '../modules/wallet.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { emitToUser, getSocketIo } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';
import anchorLevelService from './anchor-level.service.js';

class GiftService {
  /**
   * Admin: Create a new virtual gift.
   */
  async createGift(data) {
    const gift = await giftRepository.create(data);
    await bumpCacheVersion('gifts');
    return gift;
  }

  /**
   * Admin: Update gift details.
   */
  async updateGift(id, data) {
    const gift = await giftRepository.updateById(id, data);
    if (!gift) throw new ApiError(404, 'Gift not found');

    await Promise.all([
      deleteCache(`gift:${id}`),
      bumpCacheVersion('gifts')
    ]);
    return gift;
  }

  /**
   * Admin: Delete a gift.
   */
  async deleteGift(id) {
    const gift = await giftRepository.deleteById(id);
    if (!gift) throw new ApiError(404, 'Gift not found');

    await Promise.all([
      deleteCache(`gift:${id}`),
      bumpCacheVersion('gifts')
    ]);
    return gift;
  }

  /**
   * Public: Get all active virtual gifts (Cached).
   */
  async getAllGifts(query) {
    const version = await getCacheVersion('gifts');
    const cacheKey = `gifts:list:v${version}:${JSON.stringify(query)}`;
    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const filter = {};
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    } else {
      filter.isActive = true; // Default to active gifts only
    }

    if (query.category) {
      filter.category = query.category;
    }

    const limit = parseInt(query.limit, 10) || 50;
    const skip = (parseInt(query.page, 10) - 1) * limit || 0;

    const gifts = await giftRepository.findMany(filter, '', '', { createdAt: -1 }, limit, skip);
    await setCache(cacheKey, gifts, 300); // 5 mins cache
    return gifts;
  }

  /**
   * Admin: Paginated gift catalog with total metadata.
   */
  async getAdminGifts(query) {
    const page = parseInt(query.page, 10) || 1;
    const limit = Math.min(parseInt(query.limit, 10) || 20, 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.category) filter.category = query.category;
    if (query.q?.trim()) {
      filter.name = { $regex: query.q.trim(), $options: 'i' };
    }

    const sortField = ['createdAt', 'name', 'coin'].includes(query.sortBy) ? query.sortBy : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };

    const [docs, total] = await Promise.all([
      giftRepository.findMany(filter, '', '', sort, limit, skip),
      giftRepository.countDocuments(filter),
    ]);

    return {
      docs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  /**
   * Admin: Lightweight KPI stats for gift catalog header.
   */
  async getAdminGiftStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [total, active, inactive, last7DaysTxs] = await Promise.all([
      giftRepository.countDocuments({}),
      giftRepository.countDocuments({ isActive: true }),
      giftRepository.countDocuments({ isActive: false }),
      GiftTransaction.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo },
            status: 'SUCCESS',
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalCoins: { $sum: '$coins' },
          },
        },
      ]),
    ]);

    const stats7d = last7DaysTxs[0] || { count: 0, totalCoins: 0 };

    return {
      total,
      active,
      inactive,
      sent7d: stats7d.count,
      revenue7d: stats7d.totalCoins,
    };
  }

  /**
   * Public: Get a single gift by ID.
   */
  async getGiftById(id) {
    const cacheKey = `gift:${id}`;
    const cachedGift = await getCache(cacheKey);
    if (cachedGift) return cachedGift;

    const gift = await giftRepository.findById(id);
    if (!gift) throw new ApiError(404, 'Gift not found');

    await setCache(cacheKey, gift, 300);
    return gift;
  }

  /**
   * Perform gift transfer transaction.
   * High performance, atomic Mongoose transaction with parallel pre-fetches and non-blocking cache/events.
   */
  async sendGift(senderId, senderRole, data) {
    const { giftId, receiverId, liveRoomId, sessionId: callSessionId } = data || {};

    if (!giftId || !receiverId) {
      throw new ApiError(400, 'Gift ID and Receiver ID are required');
    }

    if (senderId.toString() === receiverId.toString()) {
      throw new ApiError(400, 'You cannot send a gift to yourself');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Parallel Pre-fetch: Gift, Receiver, Sender, and Sender Wallet (Single round-trip)
      const [gift, receiver, sender, wallet] = await Promise.all([
        giftRepository.findById(giftId, '', '', false),
        userRepository.findById(receiverId, '', '', false),
        userRepository.findById(senderId, '', '', false),
        Wallet.findOne({ userId: senderId }).session(session),
      ]);

      if (!gift || !gift.isActive) {
        throw new ApiError(404, 'Gift not found or is currently inactive');
      }

      if (!receiver || receiver.isDeleted || receiver.isBlocked) {
        throw new ApiError(404, 'Receiver user not found or is inactive');
      }

      let transactionType;
      let earningCoins = 0;
      let adminCoins = 0;
      const coinLedgerEntries = [];
      const dbSavePromises = [];

      // Handle CUSTOMER sender logic
      if (senderRole === 'CUSTOMER') {
        if (receiver.type !== 'LISTENER') {
          throw new ApiError(400, 'Customers can only send gifts to listeners');
        }

        if (!wallet || wallet.coinBalance < gift.coin) {
          throw new ApiError(400, 'Insufficient coin balance in your wallet');
        }

        // Calculate distribution
        earningCoins = Math.floor((gift.coin * (gift.earningPercent || 70)) / 100);
        adminCoins = gift.coin - earningCoins;

        // 2. Debit sender wallet
        wallet.coinBalance -= gift.coin;
        wallet.totalSpent = (wallet.totalSpent || 0) + gift.coin;
        dbSavePromises.push(wallet.save({ session }));

        // 3. Parallel fetch receiver's Profile & Wallet
        const [existingProfile, existingWallet] = await Promise.all([
          ListenerProfile.findOne({ userId: receiverId }).session(session),
          Wallet.findOne({ userId: receiverId }).session(session),
        ]);

        let listenerProfile = existingProfile;
        if (!listenerProfile) {
          listenerProfile = new ListenerProfile({
            userId: receiverId,
            availableBalance: 0,
            totalEarnings: 0,
          });
        }
        listenerProfile.availableBalance = (listenerProfile.availableBalance || 0) + earningCoins;
        listenerProfile.totalEarnings = (listenerProfile.totalEarnings || 0) + earningCoins;
        listenerProfile.giftsReceivedCount = (listenerProfile.giftsReceivedCount || 0) + 1;
        dbSavePromises.push(listenerProfile.save({ session }));

        let listenerWallet = existingWallet;
        if (!listenerWallet) {
          listenerWallet = new Wallet({ userId: receiverId, coinBalance: 0 });
        }
        listenerWallet.coinBalance = (listenerWallet.coinBalance || 0) + earningCoins;
        listenerWallet.totalEarned = (listenerWallet.totalEarned || 0) + earningCoins;
        dbSavePromises.push(listenerWallet.save({ session }));

        // 4. Batch ledger transactions (Sender DEBIT + Receiver CREDIT)
        coinLedgerEntries.push(
          {
            userId: senderId,
            type: 'DEBIT',
            amount: gift.coin,
            balanceAfter: wallet.coinBalance,
            referenceType: 'GIFT',
            description: `Sent gift "${gift.name}" to listener ${receiver.firstName || ''}`,
          },
          {
            userId: receiverId,
            type: 'CREDIT',
            amount: earningCoins,
            balanceAfter: listenerWallet.coinBalance,
            referenceType: 'GIFT',
            description: `Earned from gift "${gift.name}" from ${sender?.firstName || 'User'}`,
          }
        );

        transactionType = 'USER_TO_LISTENER';

      } else if (senderRole === 'ADMIN') {
        // ADMIN sending promotional / bonus gift
        earningCoins = Math.floor((gift.coin * (gift.earningPercent || 70)) / 100);
        adminCoins = gift.coin - earningCoins;

        if (receiver.type === 'CUSTOMER') {
          let receiverWallet = await Wallet.findOne({ userId: receiverId }).session(session);
          if (!receiverWallet) {
            receiverWallet = new Wallet({
              userId: receiverId,
              coinBalance: 0,
              totalRecharge: 0,
              totalSpent: 0,
              totalEarned: 0,
              totalWithdrawn: 0,
            });
          }
          receiverWallet.coinBalance = (receiverWallet.coinBalance || 0) + gift.coin;
          receiverWallet.totalEarned = (receiverWallet.totalEarned || 0) + gift.coin;
          dbSavePromises.push(receiverWallet.save({ session }));

          coinLedgerEntries.push({
            userId: receiverId,
            type: 'CREDIT',
            amount: gift.coin,
            balanceAfter: receiverWallet.coinBalance,
            referenceType: 'GIFT',
            description: `Received gift "${gift.name}" from Admin`,
          });

          transactionType = 'ADMIN_TO_USER';

        } else if (receiver.type === 'LISTENER') {
          const [existingProfile, existingWallet] = await Promise.all([
            ListenerProfile.findOne({ userId: receiverId }).session(session),
            Wallet.findOne({ userId: receiverId }).session(session),
          ]);

          let listenerProfile = existingProfile;
          if (!listenerProfile) {
            listenerProfile = new ListenerProfile({
              userId: receiverId,
              availableBalance: 0,
              totalEarnings: 0,
            });
          }
          listenerProfile.availableBalance = (listenerProfile.availableBalance || 0) + earningCoins;
          listenerProfile.totalEarnings = (listenerProfile.totalEarnings || 0) + earningCoins;
          listenerProfile.giftsReceivedCount = (listenerProfile.giftsReceivedCount || 0) + 1;
          dbSavePromises.push(listenerProfile.save({ session }));

          let listenerWallet = existingWallet;
          if (!listenerWallet) {
            listenerWallet = new Wallet({ userId: receiverId, coinBalance: 0 });
          }
          listenerWallet.coinBalance = (listenerWallet.coinBalance || 0) + earningCoins;
          listenerWallet.totalEarned = (listenerWallet.totalEarned || 0) + earningCoins;
          dbSavePromises.push(listenerWallet.save({ session }));

          coinLedgerEntries.push({
            userId: receiverId,
            type: 'CREDIT',
            amount: earningCoins,
            balanceAfter: listenerWallet.coinBalance,
            referenceType: 'GIFT',
            description: `Received gift "${gift.name}" from Admin`,
          });

          transactionType = 'ADMIN_TO_LISTENER';
        } else {
          throw new ApiError(400, 'Unsupported receiver role type');
        }
      } else {
        throw new ApiError(403, 'Unauthorized sender role for sending gifts');
      }

      // 5. Execute document saves and create ledger + gift transaction in parallel
      await Promise.all([
        ...dbSavePromises,
        CoinTransaction.create(coinLedgerEntries, { session }),
        GiftTransaction.create([{
          giftId,
          senderId,
          receiverId,
          coins: gift.coin,
          earningPercent: gift.earningPercent || 70,
          adminPercent: adminCoins > 0 ? (100 - (gift.earningPercent || 70)) : 0,
          earningCoins,
          adminCoins,
          type: transactionType,
          status: 'SUCCESS',
        }], { session }),
      ]);

      await session.commitTransaction();
      session.endSession();

      // 6. Non-blocking Post-Transaction Operations (Fire-and-forget background pipeline)
      const senderIdStr = senderId.toString();
      const receiverIdStr = receiverId.toString();

      // Async cache invalidations
      const cacheBumps = [
        deleteCache(`wallet:user:${senderIdStr}`),
        deleteCache(`wallet:user:${receiverIdStr}`),
        deleteCache(`listener:${receiverIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${senderIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${receiverIdStr}`),
        bumpCacheVersion(`gifts:history:${senderIdStr}`),
        bumpCacheVersion(`gifts:history:${receiverIdStr}`),
        bumpCacheVersion('admin:wallets'),
        bumpCacheVersion('gifts'),
      ];

      Promise.all(cacheBumps).catch((err) =>
        logger.error(`[Gift Service] Cache bump error: ${err.message}`)
      );

      // Async Agent analytics & Anchor evaluation
      if (receiver.type === 'LISTENER') {
        ListenerProfile.findOne({ userId: receiverId })
          .select('createdByAgentId')
          .lean()
          .then((prof) => {
            if (prof?.createdByAgentId) {
              import('./agent.service.js').then(({ default: agentService }) => {
                agentService.bumpCache(prof.createdByAgentId.toString());
              });
            }
          })
          .catch(() => { });

        if (transactionType === 'USER_TO_LISTENER') {
          import('./agent-dashboard.service.js')
            .then(({ default: agentDashboardService }) => {
              agentDashboardService.recordActivityForListener(receiverIdStr, {
                type: 'gift',
                text: `${gift.name} gift received`,
              });
            })
            .catch(() => { });
        }

        anchorLevelService.evaluateAnchorLevel(receiverId).catch((err) =>
          logger.error(`[Gift Service] anchor eval failed for ${receiverIdStr}: ${err.message}`)
        );
      }

      // 7. Real-Time Socket Broadcast
      const senderName =
        `${sender?.firstName || ''} ${sender?.lastName || ''}`.trim() || 'Viewer';
      const senderAvatar = sender?.profileImage || null;

      const giftEventData = {
        gift: {
          id: gift._id,
          name: gift.name,
          icon: gift.icon,
          category: gift.category,
        },
        sender: {
          id: sender?._id || senderId,
          firstName: sender?.firstName,
          lastName: sender?.lastName,
          profileImage: senderAvatar,
        },
        senderName,
        senderAvatar,
        userName: senderName,
        profileImage: senderAvatar,
        liveRoomId: liveRoomId || null,
        sessionId: callSessionId || null,
        coins: gift.coin,
        earningCoins,
        type: transactionType,
        createdAt: new Date().toISOString(),
      };

      // Emit to receiver directly
      emitToUser(receiverIdStr, 'gift:received', giftEventData);

      // Broadcast to live room or session room if provided
      const io = getSocketIo();
      if (io && liveRoomId) {
        io.to(`live:${liveRoomId}`).emit('gift:received', giftEventData);
      }
      if (io && callSessionId) {
        io.to(`session:${callSessionId}`).emit('gift:received', giftEventData);
      }

      return {
        success: true,
        giftId,
        giftName: gift.name,
        coins: gift.coin,
        earningCoins,
        senderBalanceAfter: wallet.coinBalance,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Get paginated sent gifts history (Optimized with caching).
   */
  async getSentGiftsHistory(userId, queryParams) {
    const page = parseInt(queryParams.page, 10) || 1;
    const limit = parseInt(queryParams.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const version = await getCacheVersion(`gifts:history:${userId}`);
    const cacheKey = `gifts:sent:${userId}:v${version}:p${page}:l${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const matchQuery = { senderId: new mongoose.Types.ObjectId(userId) };
    const { total, data } = await giftTransactionRepository.getPaginatedTransactions(
      matchQuery,
      { createdAt: -1 },
      skip,
      limit
    );

    const result = { total, page, limit, data };
    await setCache(cacheKey, result, 120); // 2 mins cache
    return result;
  }

  /**
   * Get paginated received gifts history (Optimized with caching).
   */
  async getReceivedGiftsHistory(userId, queryParams) {
    const page = parseInt(queryParams.page, 10) || 1;
    const limit = parseInt(queryParams.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const version = await getCacheVersion(`gifts:history:${userId}`);
    const cacheKey = `gifts:received:${userId}:v${version}:p${page}:l${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const matchQuery = { receiverId: new mongoose.Types.ObjectId(userId) };
    const { total, data } = await giftTransactionRepository.getPaginatedTransactions(
      matchQuery,
      { createdAt: -1 },
      skip,
      limit
    );

    const result = { total, page, limit, data };
    await setCache(cacheKey, result, 120); // 2 mins cache
    return result;
  }

  /**
   * Admin: Get dashboard analytics for gifts.
   */
  async getAdminGiftAnalytics() {
    const version = await getCacheVersion('gifts');
    const cacheKey = `gifts:admin:analytics:v${version}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [activeGiftsCount, totalGiftsCount, last7DaysTxs, topGifts] = await Promise.all([
      giftRepository.countDocuments({ isActive: true }),
      giftRepository.countDocuments({}),
      GiftTransaction.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo },
            status: 'SUCCESS',
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalCoins: { $sum: '$coins' },
            totalEarningCoins: { $sum: '$earningCoins' },
            totalAdminCoins: { $sum: '$adminCoins' },
          },
        },
      ]),
      GiftTransaction.aggregate([
        { $match: { status: 'SUCCESS' } },
        {
          $group: {
            _id: '$giftId',
            totalRevenue: { $sum: '$coins' },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'gifts',
            localField: '_id',
            foreignField: '_id',
            as: 'gift',
          },
        },
        { $unwind: { path: '$gift', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            giftId: '$_id',
            name: { $ifNull: ['$gift.name', 'Unknown Gift'] },
            icon: { $ifNull: ['$gift.icon', ''] },
            category: { $ifNull: ['$gift.category', 'Unknown'] },
            totalRevenue: 1,
            count: 1,
          },
        },
      ]),
    ]);

    const stats7d = last7DaysTxs[0] || { count: 0, totalCoins: 0, totalEarningCoins: 0, totalAdminCoins: 0 };

    const analytics = {
      activeGiftsCount,
      totalGiftsCount,
      last7DaysStats: {
        sentCount: stats7d.count,
        totalCoinsSpent: stats7d.totalCoins,
        totalListenerEarnings: stats7d.totalEarningCoins,
        totalPlatformCommission: stats7d.totalAdminCoins,
      },
      topGifts,
    };

    await setCache(cacheKey, analytics, 60);
    return analytics;
  }
}

export default new GiftService();
