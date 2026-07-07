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
import { emitToUser } from '../utils/socket.util.js';
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
   */
  async sendGift(senderId, senderRole, data) {
    const { giftId, receiverId } = data;

    if (senderId.toString() === receiverId.toString()) {
      throw new ApiError(400, 'You cannot send a gift to yourself');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Fetch Gift
      const gift = await giftRepository.findById(giftId, '', '', false);
      if (!gift || !gift.isActive) {
        throw new ApiError(404, 'Gift not found or is currently inactive');
      }

      // 2. Fetch Receiver
      const receiver = await userRepository.findById(receiverId, '', '', false);
      if (!receiver || receiver.isDeleted || receiver.isBlocked) {
        throw new ApiError(404, 'Receiver user not found or is inactive');
      }

      // 3. Fetch Sender
      const sender = await userRepository.findById(senderId, '', '', false);

      let transactionType;
      let earningCoins = 0;
      let adminCoins = 0;

      // Handle CUSTOMER sender logic
      if (senderRole === 'CUSTOMER') {
        if (receiver.type !== 'LISTENER') {
          throw new ApiError(400, 'Customers can only send gifts to listeners');
        }

        // Check sender wallet balance
        let wallet = await Wallet.findOne({ userId: senderId }).session(session);
        if (!wallet || wallet.coinBalance < gift.coin) {
          throw new ApiError(400, 'Insufficient coin balance in your wallet');
        }

        // Calculate distribution
        earningCoins = Math.floor((gift.coin * gift.earningPercent) / 100);
        adminCoins = gift.coin - earningCoins;

        // Debit sender wallet
        wallet.coinBalance -= gift.coin;
        wallet.totalSpent += gift.coin;
        await wallet.save({ session });

        // Credit receiver listener profile
        let listenerProfile = await ListenerProfile.findOne({ userId: receiverId }).session(session);
        if (!listenerProfile) {
          // Initialize profile if it doesn't exist
          listenerProfile = new ListenerProfile({
            userId: receiverId,
            availableBalance: 0,
            totalEarnings: 0
          });
        }
        listenerProfile.availableBalance += earningCoins;
        listenerProfile.totalEarnings += earningCoins;
        listenerProfile.giftsReceivedCount = (listenerProfile.giftsReceivedCount || 0) + 1;
        await listenerProfile.save({ session });

        // Create coin ledger transaction for sender
        await CoinTransaction.create([{
          userId: senderId,
          type: 'DEBIT',
          amount: gift.coin,
          balanceAfter: wallet.coinBalance,
          referenceType: 'GIFT',
          description: `Sent gift "${gift.name}" to listener ${receiver.firstName || ''}`
        }], { session });

        transactionType = 'USER_TO_LISTENER';

      } else if (senderRole === 'ADMIN') {
        // ADMIN is sending the gift (promotional / bonus)
        earningCoins = Math.floor((gift.coin * gift.earningPercent) / 100);
        adminCoins = gift.coin - earningCoins;

        if (receiver.type === 'CUSTOMER') {
          // Credit Customer Wallet
          let wallet = await Wallet.findOne({ userId: receiverId }).session(session);
          if (!wallet) {
            wallet = new Wallet({
              userId: receiverId,
              coinBalance: 0,
              totalRecharge: 0,
              totalSpent: 0,
              totalEarned: 0,
              totalWithdrawn: 0
            });
          }
          wallet.coinBalance += gift.coin;
          wallet.totalEarned += gift.coin;
          await wallet.save({ session });

          // Create ledger transaction for customer
          await CoinTransaction.create([{
            userId: receiverId,
            type: 'CREDIT',
            amount: gift.coin,
            balanceAfter: wallet.coinBalance,
            referenceType: 'GIFT',
            description: `Received gift "${gift.name}" from Admin`
          }], { session });

          transactionType = 'ADMIN_TO_USER';

        } else if (receiver.type === 'LISTENER') {
          // Credit Listener Profile
          let listenerProfile = await ListenerProfile.findOne({ userId: receiverId }).session(session);
          if (!listenerProfile) {
            listenerProfile = new ListenerProfile({
              userId: receiverId,
              availableBalance: 0,
              totalEarnings: 0
            });
          }
          listenerProfile.availableBalance += earningCoins;
          listenerProfile.totalEarnings += earningCoins;
          listenerProfile.giftsReceivedCount = (listenerProfile.giftsReceivedCount || 0) + 1;
          await listenerProfile.save({ session });

          transactionType = 'ADMIN_TO_LISTENER';
        } else {
          throw new ApiError(400, 'Unsupported receiver role type');
        }
      } else {
        throw new ApiError(403, 'Unauthorized sender role for sending gifts');
      }

      // Create the GiftTransaction record
      const giftTx = await GiftTransaction.create([{
        giftId,
        senderId,
        receiverId,
        coins: gift.coin,
        earningPercent: gift.earningPercent,
        adminPercent: gift.adminPercent,
        earningCoins,
        adminCoins,
        type: transactionType,
        status: 'SUCCESS'
      }], { session });

      await session.commitTransaction();
      session.endSession();

      // Invalidate related cache tags
      const senderIdStr = senderId.toString();
      const receiverIdStr = receiverId.toString();
      const cacheBumps = [
        deleteCache(`wallet:user:${senderIdStr}`),
        deleteCache(`wallet:user:${receiverIdStr}`),
        deleteCache(`listener:${receiverIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${senderIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${receiverIdStr}`),
        bumpCacheVersion('admin:wallets'),
      ];

      if (receiver.type === 'LISTENER') {
        const listenerProfile = await ListenerProfile.findOne({ userId: receiverId }).select('createdByAgentId').lean();
        if (listenerProfile?.createdByAgentId) {
          const { default: agentService } = await import('./agent.service.js');
          cacheBumps.push(agentService.bumpCache(listenerProfile.createdByAgentId.toString()));
        }
      }

      await Promise.all(cacheBumps);

      if (receiver.type === 'LISTENER' && transactionType === 'USER_TO_LISTENER') {
        const { default: agentDashboardService } = await import('./agent-dashboard.service.js');
        await agentDashboardService.recordActivityForListener(receiverIdStr, {
          type: 'gift',
          text: `${gift.name} gift received`,
        });
      }

      // Re-evaluate the listener's anchor level after earnings (fire-and-forget)
      anchorLevelService.evaluateAnchorLevel(receiverId).catch((err) =>
        logger.error(`[Gift Service] anchor eval failed for ${receiverIdStr}: ${err.message}`)
      );

      // Emit real-time socket notification to the receiver
      emitToUser(receiverIdStr, 'gift:received', {
        gift: {
          id: gift._id,
          name: gift.name,
          icon: gift.icon,
          category: gift.category
        },
        sender: {
          id: sender._id,
          firstName: sender.firstName,
          lastName: sender.lastName,
          profileImage: sender.profileImage
        },
        coins: gift.coin,
        earningCoins,
        type: transactionType,
        createdAt: giftTx[0].createdAt
      });

      return giftTx[0];
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Get paginated sent gifts history.
   */
  async getSentGiftsHistory(userId, queryParams) {
    const limit = parseInt(queryParams.limit, 10) || 10;
    const skip = (parseInt(queryParams.page, 10) - 1) * limit || 0;
    const matchQuery = { senderId: new mongoose.Types.ObjectId(userId) };

    const { total, data } = await giftTransactionRepository.getPaginatedTransactions(matchQuery, { createdAt: -1 }, skip, limit);
    return { total, page: parseInt(queryParams.page, 10) || 1, limit, data };
  }

  /**
   * Get paginated received gifts history.
   */
  async getReceivedGiftsHistory(userId, queryParams) {
    const limit = parseInt(queryParams.limit, 10) || 10;
    const skip = (parseInt(queryParams.page, 10) - 1) * limit || 0;
    const matchQuery = { receiverId: new mongoose.Types.ObjectId(userId) };

    const { total, data } = await giftTransactionRepository.getPaginatedTransactions(matchQuery, { createdAt: -1 }, skip, limit);
    return { total, page: parseInt(queryParams.page, 10) || 1, limit, data };
  }

  /**
   * Admin: Get dashboard analytics for gifts.
   */
  async getAdminGiftAnalytics() {
    // 1. Active gifts count
    const activeGiftsCount = await giftRepository.countDocuments({ isActive: true });
    const totalGiftsCount = await giftRepository.countDocuments({});

    // 2. Gifts sent in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const last7DaysTxs = await GiftTransaction.aggregate([
      { 
        $match: { 
          createdAt: { $gte: sevenDaysAgo },
          status: 'SUCCESS' 
        } 
      },
      { 
        $group: { 
          _id: null, 
          count: { $sum: 1 }, 
          totalCoins: { $sum: '$coins' },
          totalEarningCoins: { $sum: '$earningCoins' },
          totalAdminCoins: { $sum: '$adminCoins' }
        } 
      }
    ]);

    const stats7d = last7DaysTxs[0] || { count: 0, totalCoins: 0, totalEarningCoins: 0, totalAdminCoins: 0 };

    // 3. Top gifts by revenue (total coins generated)
    const topGiftsGroup = await GiftTransaction.aggregate([
      { $match: { status: 'SUCCESS' } },
      { 
        $group: { 
          _id: '$giftId', 
          totalRevenue: { $sum: '$coins' }, 
          count: { $sum: 1 } 
        } 
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ]);

    // Populate gift details manually
    const topGifts = await Promise.all(
      topGiftsGroup.map(async (item) => {
        const gift = await giftRepository.findById(item._id);
        return {
          giftId: item._id,
          name: gift ? gift.name : 'Unknown Gift',
          icon: gift ? gift.icon : '',
          category: gift ? gift.category : 'Unknown',
          totalRevenue: item.totalRevenue,
          count: item.count
        };
      })
    );

    return {
      activeGiftsCount,
      totalGiftsCount,
      last7DaysStats: {
        sentCount: stats7d.count,
        totalCoinsSpent: stats7d.totalCoins,
        totalListenerEarnings: stats7d.totalEarningCoins,
        totalPlatformCommission: stats7d.totalAdminCoins
      },
      topGifts
    };
  }
}

export default new GiftService();
