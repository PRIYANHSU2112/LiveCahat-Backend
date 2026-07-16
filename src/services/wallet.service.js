import BaseService from './base.service.js';
import walletRepository from '../repositories/wallet.repository.js';
import coinTransactionRepository from '../repositories/coin-transaction.repository.js';
import paymentTransactionRepository from '../repositories/payment-transaction.repository.js';
import coinPackRepository from '../repositories/coin-pack.repository.js';
import userRepository from '../repositories/user.repository.js';
import { verifyWebhookSignature } from '../config/razorpay.config.js';
import { getPaymentAdapter } from './payment-gateway.adapters.js';
import settingsRuntime from './settings-runtime.service.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { buildUtcCreatedAtFilter } from '../utils/date-filter.util.js';
import ApiError from '../utils/ApiError.js';
import mongoose from 'mongoose';
import CoinTransaction from '../modules/coin-transaction.model.js';
import PaymentTransaction from '../modules/payment-transaction.model.js';
import Wallet from '../modules/wallet.model.js';
import User from '../modules/user.model.js';
import referralService from './referral.service.js';

class WalletService extends BaseService {
  constructor() {
    super(walletRepository);
  }

  /**
   * Get user wallet (Create one if it does not exist)
   */
  async getOrCreateWallet(userId) {
    const cacheKey = `wallet:user:${userId}`;
    const cachedWallet = await getCache(cacheKey);
    if (cachedWallet) return cachedWallet;

    let wallet = await this.repository.findByUserId(userId, false);
    if (!wallet) {
      wallet = await this.repository.create({
        userId,
        coinBalance: 0,
        totalRecharge: 0,
        totalSpent: 0,
        totalEarned: 0,
        totalWithdrawn: 0,
        status: 'ACTIVE'
      });
    }

    const walletObj = wallet.toObject ? wallet.toObject() : wallet;
    await setCache(cacheKey, walletObj, 300); // Cache for 5 mins
    return walletObj;
  }

  /**
   * Get user's coin transactions with caching and pagination
   */
  async getUserCoinTransactions(userId, queryParams) {
    const version = await getCacheVersion(`coin_transactions:user:${userId}`);
    const cacheKey = `coin_transactions:user:${userId}:list:v${version}:${JSON.stringify(queryParams)}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    const matchQuery = { userId: new mongoose.Types.ObjectId(userId) };

    if (queryParams.type) {
      matchQuery.type = queryParams.type;
    }

    const { total, data } = await coinTransactionRepository.getPaginatedTransactions(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300); // Cache for 5 mins
    return response;
  }

  /**
   * Get user's payment transactions with caching and pagination
   */
  async getUserPaymentTransactions(userId, queryParams) {
    const version = await getCacheVersion(`payment_transactions:user:${userId}`);
    const cacheKey = `payment_transactions:user:${userId}:list:v${version}:${JSON.stringify(queryParams)}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    const matchQuery = { userId: new mongoose.Types.ObjectId(userId) };

    if (queryParams.status) {
      matchQuery.status = queryParams.status;
    }

    const { total, data } = await paymentTransactionRepository.getPaginatedTransactions(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300); // Cache for 5 mins
    return response;
  }

  /**
   * Create coin pack Razorpay order
   */
  async createCoinPackOrder(userId, coinPackId) {
    const coinPack = await coinPackRepository.findById(coinPackId);
    if (!coinPack || !coinPack.isActive) {
      throw new ApiError(404, 'Coin pack not found or inactive');
    }

    const options = {
      amount: Math.round(coinPack.price * 100),
      currency: 'INR',
      receipt: `rcpt_${userId.toString().slice(-8)}_${Date.now()}`
    };

    // Prefer runtime default provider (memory); Razorpay adapter falls back to .env
    const provider = settingsRuntime.getDefaultProvider() || 'RAZORPAY';
    const adapter = getPaymentAdapter(provider);
    const order = await adapter.createOrder(options);

    const transaction = await paymentTransactionRepository.create({
      userId,
      coinPackId,
      amount: coinPack.price,
      currency: 'INR',
      paymentGateway: provider,
      OrderId: order.id,
      status: 'PENDING'
    });

    // Invalidate payment list cache version for this user
    await Promise.all([
      bumpCacheVersion(`payment_transactions:user:${userId}`),
      bumpCacheVersion('admin:payment_transactions')
    ]);

    return {
      transactionId: transaction._id,
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: adapter.getPublicKey?.() || settingsRuntime.getRazorpayPublicKey(),
      paymentGateway: provider,
      coinPack
    };
  }

  /**
   * Handle Razorpay webhook with full transactional isolation
   */
  async handleRazorpayWebhook(payload, signature, secret) {
    if (!verifyWebhookSignature(payload, signature, secret)) {
      throw new ApiError(400, 'Invalid webhook signature');
    }

    const event = JSON.parse(payload);
    if (event.event !== 'payment.captured') {
      return { status: 'ignored', reason: `Unhandled event: ${event.event}` };
    }

    const paymentData = event.payload.payment.entity;
    const orderId = paymentData.order_id;
    const paymentId = paymentData.id;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const transaction = await PaymentTransaction.findOne({ OrderId: orderId }).session(session);
      if (!transaction) {
        throw new Error(`Transaction with orderId ${orderId} not found`);
      }

      if (transaction.status === 'SUCCESS') {
        await session.abortTransaction();
        session.endSession();
        return { status: 'already_processed' };
      }

      // Update payment transaction
      transaction.status = 'SUCCESS';
      transaction.gatewayTransactionId = paymentId;
      transaction.metadata = paymentData;
      await transaction.save({ session });

      const coinPack = await coinPackRepository.findById(transaction.coinPackId);
      if (!coinPack) {
        throw new Error('Associated coin pack not found');
      }

      // Find or initialize wallet
      let wallet = await Wallet.findOne({ userId: transaction.userId }).session(session);
      if (!wallet) {
        wallet = new Wallet({
          userId: transaction.userId,
          coinBalance: 0,
          totalRecharge: 0
        });
      }

      const coinsToAdd = coinPack.coins;
      wallet.coinBalance += coinsToAdd;
      wallet.totalRecharge += transaction.amount;
      await wallet.save({ session });

      // Create Coin Transaction ledger entry
      await CoinTransaction.create([{
        userId: transaction.userId,
        type: 'CREDIT',
        amount: coinsToAdd,
        balanceAfter: wallet.coinBalance,
        referenceType: 'PURCHASE',
        referenceId: transaction._id,
        description: `Purchased ${coinsToAdd} coins via pack ${coinPack.name}`
      }], { session });

      // Referral payout — triggers once, on the referred friend's first purchase
      const buyer = await User.findById(transaction.userId)
        .select('referredBy referralRewardAwarded type')
        .session(session);
      const referralResult = await referralService.processFirstPurchaseReward(session, buyer, coinPack);

      await session.commitTransaction();
      session.endSession();

      // Clear caches asynchronously
      const userIdStr = transaction.userId.toString();
      await Promise.all([
        deleteCache(`wallet:user:${userIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${userIdStr}`),
        bumpCacheVersion(`payment_transactions:user:${userIdStr}`),
        bumpCacheVersion('admin:wallets'),
        bumpCacheVersion('admin:coin_transactions'),
        bumpCacheVersion('admin:payment_transactions'),
      ]);

      // If a referral bonus was paid, bust the referrer's caches too
      if (referralResult?.referrerId) {
        const refId = referralResult.referrerId.toString();
        await Promise.all([
          referralService._invalidateUserCaches([refId]),
          bumpCacheVersion(`coin_transactions:user:${refId}`),
        ]);
      }

      return { status: 'success', coinsAdded: coinsToAdd, referralBonus: referralResult?.bonus || 0 };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  // --- ADMIN SERVICES ---

  /**
   * Admin: platform wallet KPIs with optional date scope on transaction metrics.
   */
  async adminGetAdminStats(query = {}) {
    const { year, month, day } = query;
    const cacheKey = `wallet:admin:stats:${year || 'all'}:${month || 'all'}:${day || 'all'}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const txDateFilter = buildUtcCreatedAtFilter(query);
    const txMatch = Object.keys(txDateFilter).length ? [txDateFilter] : [];
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      walletAgg,
      statusAgg,
      coinCredit24h,
      coinDebit24h,
      payment24h,
      scopedCoinCredits,
      scopedCoinDebits,
      scopedTopUps,
    ] = await Promise.all([
      Wallet.aggregate([
        {
          $group: {
            _id: null,
            totalWallets: { $sum: 1 },
            coinsInCirculation: { $sum: '$coinBalance' },
            totalRecharge: { $sum: '$totalRecharge' },
            totalSpent: { $sum: '$totalSpent' },
            totalEarned: { $sum: '$totalEarned' },
            totalWithdrawn: { $sum: '$totalWithdrawn' },
          },
        },
      ]),
      Wallet.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      CoinTransaction.aggregate([
        { $match: { type: 'CREDIT', createdAt: { $gte: last24h } } },
        { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } },
      ]),
      CoinTransaction.aggregate([
        { $match: { type: 'DEBIT', createdAt: { $gte: last24h } } },
        { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } },
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: 'SUCCESS', createdAt: { $gte: last24h } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      CoinTransaction.aggregate([
        { $match: { type: 'CREDIT', ...txMatch } },
        { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } },
      ]),
      CoinTransaction.aggregate([
        { $match: { type: 'DEBIT', ...txMatch } },
        { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } },
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: 'SUCCESS', ...txMatch } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);

    const walletTotals = walletAgg[0] ?? {};
    const statusCounts = Object.fromEntries(statusAgg.map((s) => [s._id, s.count]));

    const stats = {
      totalWallets: walletTotals.totalWallets ?? 0,
      activeWallets: statusCounts.ACTIVE ?? 0,
      frozenWallets: statusCounts.FROZEN ?? 0,
      blockedWallets: statusCounts.BLOCKED ?? 0,
      coinsInCirculation: walletTotals.coinsInCirculation ?? 0,
      totalRecharge: walletTotals.totalRecharge ?? 0,
      totalSpent: walletTotals.totalSpent ?? 0,
      totalEarned: walletTotals.totalEarned ?? 0,
      totalWithdrawn: walletTotals.totalWithdrawn ?? 0,
      coinCredits24h: coinCredit24h[0]?.volume ?? 0,
      coinDebits24h: coinDebit24h[0]?.volume ?? 0,
      topUps24h: {
        count: payment24h[0]?.count ?? 0,
        amount: payment24h[0]?.amount ?? 0,
      },
      scopedCoinCredits: scopedCoinCredits[0]?.volume ?? 0,
      scopedCoinDebits: scopedCoinDebits[0]?.volume ?? 0,
      scopedTopUps: {
        count: scopedTopUps[0]?.count ?? 0,
        amount: scopedTopUps[0]?.amount ?? 0,
      },
      dateScope: {
        year: year ? parseInt(year, 10) : null,
        month: month ? parseInt(month, 10) : null,
        day: day ? parseInt(day, 10) : null,
      },
    };

    await setCache(cacheKey, stats, 30);
    return stats;
  }

  /**
   * Admin: get wallet by user id with user summary.
   */
  async adminGetWalletByUserId(userId) {
    const wallet = await this.repository.findByUserId(userId, false);
    if (!wallet) {
      throw new ApiError(404, 'Wallet not found for this user');
    }
    const populated = await Wallet.findById(wallet._id)
      .populate('userId', 'firstName lastName email mobileNumber profileImage type')
      .lean();
    return populated;
  }

  /**
   * Admin: get wallet by wallet id with user summary.
   */
  async adminGetWalletById(walletId) {
    const wallet = await Wallet.findById(walletId)
      .populate('userId', 'firstName lastName email mobileNumber profileImage type')
      .lean();
    if (!wallet) {
      throw new ApiError(404, 'Wallet not found');
    }
    return wallet;
  }

  /**
   * Admin: List all wallets with pagination & search filtering
   */
  async adminGetAllWallets(queryParams) {
    const version = await getCacheVersion('admin:wallets');
    const cacheKey = `admin:wallets:list:v${version}:${JSON.stringify(queryParams)}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    const matchQuery = { ...buildUtcCreatedAtFilter(queryParams) };

    if (queryParams.status) {
      matchQuery.status = queryParams.status;
    }

    if (queryParams.search) {
      const users = await userRepository.findMany({
        $or: [
          { firstName: { $regex: queryParams.search, $options: 'i' } },
          { lastName: { $regex: queryParams.search, $options: 'i' } },
          { mobileNumber: { $regex: queryParams.search, $options: 'i' } },
          { email: { $regex: queryParams.search, $options: 'i' } }
        ]
      }, '_id');
      const userIds = users.map(u => u._id);
      matchQuery.userId = { $in: userIds };
    }

    const { total, data } = await this.repository.getPaginatedWallets(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300);
    return response;
  }

  /**
   * Admin: List all coin transactions with pagination & filters
   */
  async adminGetAllCoinTransactions(queryParams) {
    const version = await getCacheVersion('admin:coin_transactions');
    const cacheKey = `admin:coin_transactions:list:v${version}:${JSON.stringify(queryParams)}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    const matchQuery = { ...buildUtcCreatedAtFilter(queryParams) };

    if (queryParams.userId) {
      matchQuery.userId = new mongoose.Types.ObjectId(queryParams.userId);
    }
    if (queryParams.type) {
      matchQuery.type = queryParams.type;
    }
    if (queryParams.referenceType) {
      matchQuery.referenceType = queryParams.referenceType;
    }

    const { total, data } = await coinTransactionRepository.getPaginatedTransactions(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300);
    return response;
  }

  /**
   * Admin: List all payment transactions with pagination & filters
   */
  async adminGetAllPaymentTransactions(queryParams) {
    const version = await getCacheVersion('admin:payment_transactions');
    const cacheKey = `admin:payment_transactions:list:v${version}:${JSON.stringify(queryParams)}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    const matchQuery = { ...buildUtcCreatedAtFilter(queryParams) };

    if (queryParams.userId) {
      matchQuery.userId = new mongoose.Types.ObjectId(queryParams.userId);
    }
    if (queryParams.status) {
      matchQuery.status = queryParams.status;
    }

    const { total, data } = await paymentTransactionRepository.getPaginatedTransactions(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300);
    return response;
  }

  /**
   * Admin: Manual credit/debit coins
   */
  async adminCreditDebitCoins(userId, data, adminId = null) {
    const { amount, type, referenceType, description } = data;
    const adminNote = adminId
      ? `Admin ${adminId}: ${description || `${type} of ${amount} coins`}`
      : (description || `Admin adjustment: ${type} of ${amount} coins`);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let wallet = await Wallet.findOne({ userId }).session(session);
      if (!wallet) {
        wallet = new Wallet({
          userId,
          coinBalance: 0,
          totalRecharge: 0,
          totalSpent: 0,
          totalEarned: 0,
          totalWithdrawn: 0
        });
      }

      if (type === 'DEBIT') {
        if (wallet.coinBalance < amount) {
          throw new ApiError(400, 'Insufficient coin balance in user wallet');
        }
        wallet.coinBalance -= amount;
        wallet.totalSpent += amount;
      } else {
        wallet.coinBalance += amount;
        wallet.totalEarned += amount;
      }

      await wallet.save({ session });

      const coinTx = await CoinTransaction.create([{
        userId,
        type,
        amount,
        balanceAfter: wallet.coinBalance,
        referenceType,
        description: adminNote
      }], { session });

      await session.commitTransaction();
      session.endSession();

      // Clear caches
      const userIdStr = userId.toString();
      await Promise.all([
        deleteCache(`wallet:user:${userIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${userIdStr}`),
        bumpCacheVersion('admin:wallets'),
        bumpCacheVersion('admin:coin_transactions')
      ]);

      return {
        wallet,
        transaction: coinTx[0]
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Admin: Update wallet status (ACTIVE, FROZEN, BLOCKED)
   */
  async adminUpdateWalletStatus(walletId, status) {
    const wallet = await this.repository.updateById(walletId, { status });
    if (!wallet) {
      throw new ApiError(404, 'Wallet not found');
    }

    const userIdStr = wallet.userId.toString();
    await Promise.all([
      deleteCache(`wallet:user:${userIdStr}`),
      bumpCacheVersion('admin:wallets')
    ]);

    return wallet;
  }
}

export const walletService = new WalletService();
