import mongoose from 'mongoose';
import withdrawalRepository from '../repositories/withdrawal.repository.js';
import bankAccountRepository from '../repositories/bank-account.repository.js';
import { buildBankSnapshot } from './bank-account.service.js';
import Withdrawal from '../modules/withdrawal.model.js';
import WithdrawalConfig from '../modules/withdrawal-config.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Wallet from '../modules/wallet.model.js';
import User from '../modules/user.model.js';
import Notification from '../modules/notification.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { buildUtcCreatedAtFilter } from '../utils/date-filter.util.js';
import logger from '../utils/logger.util.js';

const CONFIG_CACHE_KEY = 'withdrawal:config';
const CACHE_NS = 'withdrawals';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const USER_POPULATE = { path: 'userId', select: 'firstName lastName email mobileNumber profileImage' };

class WithdrawalService {
  // ─── Config (singleton) ─────────────────────────────────────────
  async getConfig() {
    const cached = await getCache(CONFIG_CACHE_KEY);
    if (cached) return cached;

    let config = await WithdrawalConfig.findOne();
    if (!config) config = await WithdrawalConfig.create({});

    const plain = config.toObject ? config.toObject() : config;
    await setCache(CONFIG_CACHE_KEY, plain, 1800); // 30 min
    return plain;
  }

  async updateConfig(data) {
    const config = await WithdrawalConfig.findOneAndUpdate({}, { $set: data }, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
    await deleteCache(CONFIG_CACHE_KEY);
    return config;
  }

  // ─── Conversion breakdown ───────────────────────────────────────
  _computeBreakdown(coins, config) {
    const rate = config.conversionInr / config.conversionCoins;
    const grossInr = round2(coins * rate);
    const feeInr = round2((grossInr * (config.feePercentage || 0)) / 100);
    const netInr = round2(grossInr - feeInr);
    return {
      coins,
      conversionCoins: config.conversionCoins,
      conversionInr: config.conversionInr,
      ratePerCoin: round2(rate),
      grossInr,
      feePercentage: config.feePercentage || 0,
      feeInr,
      netInr,
    };
  }

  async quote(coins) {
    const config = await this.getConfig();
    const breakdown = this._computeBreakdown(coins, config);
    return {
      ...breakdown,
      minWithdrawalCoins: config.minWithdrawalCoins,
      meetsMinimum: coins >= config.minWithdrawalCoins,
    };
  }

  // ─── User: request a withdrawal ─────────────────────────────────
  async requestWithdrawal(user, { coins, bankAccountId }) {
    const isListener = user.type === 'LISTENER';
    const isAgent = user.type === 'AGENT';
    if (!isListener && !isAgent) {
      throw new ApiError(403, 'Only listeners and agents can withdraw earnings.');
    }

    // Listeners must have an approved KYC; agents withdraw from their wallet directly.
    if (isListener) {
      const profile = await ListenerProfile.findOne({ userId: user._id }).select('kycStatus').lean();
      if (!profile) throw new ApiError(404, 'Listener profile not found.');
      if (profile.kycStatus !== 'APPROVED') {
        throw new ApiError(403, 'Your KYC must be approved before you can withdraw.');
      }
    }

    const config = await this.getConfig();
    if (coins < config.minWithdrawalCoins) {
      throw new ApiError(400, `Minimum withdrawal is ${config.minWithdrawalCoins} coins.`);
    }

    const bankAccount = await bankAccountRepository.findById(bankAccountId);
    if (!bankAccount) throw new ApiError(404, 'Bank account not found.');
    if (bankAccount.userId.toString() !== user._id.toString()) {
      throw new ApiError(403, 'This bank account does not belong to you.');
    }

    const breakdown = this._computeBreakdown(coins, config);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Atomic, race-safe debit of the withdrawable balance: listeners draw from
      // their earned (available) balance, agents from their wallet coin balance.
      const debited = isListener
        ? await ListenerProfile.findOneAndUpdate(
            { userId: user._id, availableBalance: { $gte: coins } },
            { $inc: { availableBalance: -coins } },
            { new: true, session }
          )
        : await Wallet.findOneAndUpdate(
            { userId: user._id, coinBalance: { $gte: coins } },
            { $inc: { coinBalance: -coins } },
            { new: true, session }
          );
      if (!debited) {
        throw new ApiError(400, 'Insufficient available balance for this withdrawal.');
      }

      const [withdrawal] = await Withdrawal.create(
        [{
          userId: user._id,
          bankAccountId,
          bankAccountSnapshot: buildBankSnapshot(bankAccount),
          coinsRequested: coins,
          conversionCoins: breakdown.conversionCoins,
          conversionInr: breakdown.conversionInr,
          grossInr: breakdown.grossInr,
          feePercentage: breakdown.feePercentage,
          feeInr: breakdown.feeInr,
          netInr: breakdown.netInr,
          status: 'PENDING',
        }],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      await this._invalidate(user._id);
      return withdrawal;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  // ─── User: history / detail / cancel ────────────────────────────
  async getMyWithdrawals(userId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({ sortBy: 'createdAt', sortOrder: 'desc', ...query });
    const filter = { userId };
    if (query.status) filter.status = query.status;

    const [docs, total] = await Promise.all([
      withdrawalRepository.findMany(filter, '', '', sort, limit, skip),
      withdrawalRepository.countDocuments(filter),
    ]);
    return formatPaginatedResponse(docs, total, page, limit);
  }

  /**
   * Aggregated KPI stats for the agent withdrawal module stat cards.
   */
  async getMyWithdrawalStats(userId, status) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const match = { userId: userObjectId, status };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    if (status === 'PENDING') {
      const [row] = await Withdrawal.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalNetInr: { $sum: '$netInr' },
            avgNetInr: { $avg: '$netInr' },
            oldestCreatedAt: { $min: '$createdAt' },
          },
        },
      ]);

      const count = row?.count ?? 0;
      const oldestDays = row?.oldestCreatedAt
        ? Math.floor((now.getTime() - new Date(row.oldestCreatedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        status,
        count,
        totalNetInr: round2(row?.totalNetInr ?? 0),
        avgNetInr: count ? round2(row?.avgNetInr ?? 0) : 0,
        oldestDays,
        thisMonthNetInr: null,
        thisMonthCount: null,
        avgProcessingHours: null,
        topReason: null,
      };
    }

    if (status === 'APPROVED') {
      const [row] = await Withdrawal.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalNetInr: { $sum: '$netInr' },
            thisMonthNetInr: {
              $sum: {
                $cond: [{ $gte: ['$processedAt', monthStart] }, '$netInr', 0],
              },
            },
            avgProcessingMs: {
              $avg: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$processedAt', null] },
                      { $ne: ['$createdAt', null] },
                    ],
                  },
                  { $subtract: ['$processedAt', '$createdAt'] },
                  null,
                ],
              },
            },
          },
        },
      ]);

      const avgProcessingHours = row?.avgProcessingMs
        ? Math.round(row.avgProcessingMs / (1000 * 60 * 60))
        : null;

      return {
        status,
        count: row?.count ?? 0,
        totalNetInr: round2(row?.totalNetInr ?? 0),
        avgNetInr: null,
        oldestDays: null,
        thisMonthNetInr: round2(row?.thisMonthNetInr ?? 0),
        thisMonthCount: null,
        avgProcessingHours,
        topReason: null,
      };
    }

    // REJECTED
    const [[summary], topReasonRow] = await Promise.all([
      Withdrawal.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalNetInr: { $sum: '$netInr' },
            thisMonthCount: {
              $sum: {
                $cond: [{ $gte: ['$createdAt', monthStart] }, 1, 0],
              },
            },
          },
        },
      ]),
      Withdrawal.aggregate([
        { $match: { ...match, rejectionReason: { $nin: [null, ''] } } },
        { $group: { _id: '$rejectionReason', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ]),
    ]);

    const row = summary ?? {};
    const topReason = topReasonRow[0]?._id ?? null;

    return {
      status,
      count: row.count ?? 0,
      totalNetInr: round2(row.totalNetInr ?? 0),
      avgNetInr: null,
      oldestDays: null,
      thisMonthNetInr: null,
      thisMonthCount: row.thisMonthCount ?? 0,
      avgProcessingHours: null,
      topReason,
    };
  }

  async getWithdrawalById(id, user) {
    const withdrawal = await withdrawalRepository.findById(id);
    if (!withdrawal) throw new ApiError(404, 'Withdrawal not found');

    const isOwner = withdrawal.userId.toString() === user._id.toString();
    if (!isOwner && user.type !== 'ADMIN') {
      throw new ApiError(403, 'You do not have permission to view this withdrawal.');
    }
    return withdrawal;
  }

  async cancelWithdrawal(userId, id) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: id, userId, status: 'PENDING' },
        { status: 'CANCELLED' },
        { new: true, session }
      );
      if (!withdrawal) {
        throw new ApiError(400, 'Withdrawal not found or can no longer be cancelled.');
      }

      // Refund the reserved coins to the user's correct balance source
      await this._refundCoins(session, userId, withdrawal.coinsRequested);

      await session.commitTransaction();
      session.endSession();

      await this._invalidate(userId);
      return withdrawal;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  // ─── Admin ──────────────────────────────────────────────────────
  async getAdminStats(query = {}) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const dateFilter = buildUtcCreatedAtFilter(query);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const processedMatch = hasDateFilter
      ? { status: 'APPROVED', ...dateFilter }
      : { status: 'APPROVED', processedAt: { $gte: sevenDaysAgo } };

    const rejectedMatch = hasDateFilter
      ? { status: 'REJECTED', ...dateFilter }
      : { status: 'REJECTED', processedAt: { $gte: sevenDaysAgo } };

    const [pendingRow, processedRow, rejectedRow] = await Promise.all([
      Withdrawal.aggregate([
        { $match: { status: 'PENDING' } },
        { $group: { _id: null, count: { $sum: 1 }, totalNetInr: { $sum: '$netInr' } } },
      ]),
      Withdrawal.aggregate([
        { $match: processedMatch },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalNetInr: { $sum: '$netInr' },
            avgProcessingMs: {
              $avg: {
                $cond: [
                  { $and: [{ $ne: ['$processedAt', null] }, { $ne: ['$createdAt', null] }] },
                  { $subtract: ['$processedAt', '$createdAt'] },
                  null,
                ],
              },
            },
          },
        },
      ]),
      Withdrawal.countDocuments(rejectedMatch),
    ]);

    const pending = pendingRow[0] ?? {};
    const processed = processedRow[0] ?? {};
    const { year, month, day } = query;

    return {
      pending: {
        count: pending.count ?? 0,
        totalNetInr: round2(pending.totalNetInr ?? 0),
      },
      processed7d: {
        count: processed.count ?? 0,
        totalNetInr: round2(processed.totalNetInr ?? 0),
      },
      failed: { count: rejectedRow },
      avgProcessingHours: processed.avgProcessingMs
        ? Math.round(processed.avgProcessingMs / (1000 * 60 * 60))
        : null,
      dateScope: {
        year: year ? parseInt(year, 10) : null,
        month: month ? parseInt(month, 10) : null,
        day: day ? parseInt(day, 10) : null,
      },
    };
  }

  async adminGetWithdrawalById(id) {
    const withdrawal = await Withdrawal.findById(id)
      .populate('userId', 'firstName lastName email mobileNumber profileImage type')
      .populate('processedBy', 'firstName lastName email type')
      .lean();
    if (!withdrawal) throw new ApiError(404, 'Withdrawal not found');

    const user = withdrawal.userId;
    return {
      id: withdrawal._id.toString(),
      user: user
        ? {
            id: user._id.toString(),
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            type: user.type,
          }
        : null,
      listener:
        user?.type === 'LISTENER'
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
          : `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Agent',
      amountCoins: withdrawal.coinsRequested,
      grossInr: withdrawal.grossInr,
      feeInr: withdrawal.feeInr,
      feePercentage: withdrawal.feePercentage,
      netInr: withdrawal.netInr,
      conversionCoins: withdrawal.conversionCoins,
      conversionInr: withdrawal.conversionInr,
      method: withdrawal.bankAccountSnapshot?.methodType
        ? `${withdrawal.bankAccountSnapshot.methodType}${withdrawal.bankAccountSnapshot.maskedAccount ? ` · ${withdrawal.bankAccountSnapshot.maskedAccount}` : ''}`
        : '—',
      bankAccountSnapshot: withdrawal.bankAccountSnapshot,
      status: withdrawal.status,
      rejectionReason: withdrawal.rejectionReason,
      processedBy: withdrawal.processedBy,
      requestedAt: withdrawal.createdAt,
      processedAt: withdrawal.processedAt,
      createdAt: withdrawal.createdAt,
    };
  }

  async adminListWithdrawals(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({ sortBy: 'createdAt', sortOrder: 'desc', ...query });

    const match = { ...buildUtcCreatedAtFilter(query) };
    if (query.status) match.status = query.status;
    if (query.userId) match.userId = new mongoose.Types.ObjectId(query.userId);

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
    ];

    if (query.userType) {
      pipeline.push({ $match: { 'user.type': query.userType } });
    }

    if (query.search?.trim()) {
      const regex = { $regex: query.search.trim(), $options: 'i' };
      pipeline.push({
        $match: {
          $or: [
            { 'user.firstName': regex },
            { 'user.lastName': regex },
            { 'user.email': regex },
          ],
        },
      });
    }

    const countPipeline = [...pipeline, { $count: 'total' }];
    pipeline.push({ $sort: sort }, { $skip: skip }, { $limit: limit });

    const [countResult, docs] = await Promise.all([
      Withdrawal.aggregate(countPipeline),
      Withdrawal.aggregate(pipeline),
    ]);

    const total = countResult[0]?.total ?? 0;
    const rows = docs.map((w) => ({
      id: w._id.toString(),
      user: {
        id: w.user._id.toString(),
        firstName: w.user.firstName,
        lastName: w.user.lastName,
        email: w.user.email,
        type: w.user.type,
      },
      listener:
        w.user.type === 'LISTENER'
          ? `${w.user.firstName || ''} ${w.user.lastName || ''}`.trim() || w.user.email
          : `${w.user.firstName || ''} ${w.user.lastName || ''}`.trim() || 'Agent',
      amountCoins: w.coinsRequested,
      netInr: w.netInr,
      amount: w.netInr,
      method: w.bankAccountSnapshot?.methodType
        ? `${w.bankAccountSnapshot.methodType}${w.bankAccountSnapshot.maskedAccount ? ` · ${w.bankAccountSnapshot.maskedAccount}` : ''}`
        : '—',
      status: w.status,
      requestedAt: w.createdAt,
      processedAt: w.processedAt,
      createdAt: w.createdAt,
    }));

    return formatPaginatedResponse(rows, total, page, limit);
  }

  async adminApprove(adminId, id) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: id, status: 'PENDING' },
        { status: 'APPROVED', processedBy: adminId, processedAt: new Date() },
        { new: true, session }
      );
      if (!withdrawal) {
        throw new ApiError(400, 'Withdrawal not found or already processed.');
      }

      // Coins were already debited at request time; record the payout against
      // the correct ledger (listener profile vs agent wallet).
      const owner = await User.findById(withdrawal.userId).select('type').lean();
      if (owner?.type === 'LISTENER') {
        await ListenerProfile.updateOne(
          { userId: withdrawal.userId },
          { $inc: { withdrawnAmount: withdrawal.coinsRequested } },
          { session }
        );
      } else {
        await Wallet.updateOne(
          { userId: withdrawal.userId },
          { $inc: { totalWithdrawn: withdrawal.coinsRequested } },
          { session }
        );
      }

      await this._notify(
        session,
        withdrawal.userId,
        '💸 Withdrawal Approved',
        `Your withdrawal of ₹${withdrawal.netInr} has been approved and is being processed.`
      );

      await session.commitTransaction();
      session.endSession();

      await this._invalidate(withdrawal.userId);
      return withdrawal;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  async adminReject(adminId, id, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: id, status: 'PENDING' },
        { status: 'REJECTED', rejectionReason: reason, processedBy: adminId, processedAt: new Date() },
        { new: true, session }
      );
      if (!withdrawal) {
        throw new ApiError(400, 'Withdrawal not found or already processed.');
      }

      // Refund the reserved coins back to the user's correct balance source
      await this._refundCoins(session, withdrawal.userId, withdrawal.coinsRequested);

      await this._notify(
        session,
        withdrawal.userId,
        '⚠️ Withdrawal Rejected',
        `Your withdrawal was rejected: ${reason}. ${withdrawal.coinsRequested} coins have been refunded.`
      );

      await session.commitTransaction();
      session.endSession();

      await this._invalidate(withdrawal.userId);
      return withdrawal;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────
  // Refund reserved coins to the correct balance source for the withdrawing
  // user: listeners earn into their ListenerProfile, agents into their Wallet.
  async _refundCoins(session, userId, coins) {
    const owner = await User.findById(userId).select('type').lean();
    if (owner?.type === 'LISTENER') {
      await ListenerProfile.updateOne({ userId }, { $inc: { availableBalance: coins } }, { session });
    } else {
      await Wallet.updateOne({ userId }, { $inc: { coinBalance: coins } }, { session });
    }
  }

  async _notify(session, userId, title, body) {
    try {
      await Notification.create([{ recipientId: userId, title, body, type: 'PAYOUT_PROCESSED' }], { session });
    } catch (err) {
      logger.error(`[WithdrawalService] notification failed for ${userId}: ${err.message}`);
    }
  }

  async _invalidate(userId) {
    const userIdStr = userId.toString();
    const bumps = [
      bumpCacheVersion(CACHE_NS),
      deleteCache(`user:${userIdStr}`),
      deleteCache(`auth:user:${userIdStr}`),
    ];

    const owner = await User.findById(userId).select('type').lean();
    if (owner?.type === 'AGENT') {
      const { default: agentService } = await import('./agent.service.js');
      bumps.push(agentService.bumpCache(userIdStr));
    }

    await Promise.all(bumps);
  }
}

export default new WithdrawalService();
