import mongoose from 'mongoose';
import withdrawalRepository from '../repositories/withdrawal.repository.js';
import bankAccountRepository from '../repositories/bank-account.repository.js';
import { buildBankSnapshot } from './bank-account.service.js';
import Withdrawal from '../modules/withdrawal.model.js';
import WithdrawalConfig from '../modules/withdrawal-config.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Notification from '../modules/notification.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
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
    if (user.type !== 'LISTENER') {
      throw new ApiError(403, 'Only listeners can withdraw earnings.');
    }

    const profile = await ListenerProfile.findOne({ userId: user._id }).select('kycStatus availableBalance').lean();
    if (!profile) throw new ApiError(404, 'Listener profile not found.');
    if (profile.kycStatus !== 'APPROVED') {
      throw new ApiError(403, 'Your KYC must be approved before you can withdraw.');
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
      // Atomic, race-safe debit of the listener's available (earned) balance
      const debited = await ListenerProfile.findOneAndUpdate(
        { userId: user._id, availableBalance: { $gte: coins } },
        { $inc: { availableBalance: -coins } },
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

      // Refund the reserved coins
      await ListenerProfile.updateOne(
        { userId },
        { $inc: { availableBalance: withdrawal.coinsRequested } },
        { session }
      );

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
  async adminListWithdrawals(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({ sortBy: 'createdAt', sortOrder: 'desc', ...query });
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.userId) filter.userId = query.userId;

    const [docs, total] = await Promise.all([
      withdrawalRepository.findMany(filter, '', USER_POPULATE, sort, limit, skip),
      withdrawalRepository.countDocuments(filter),
    ]);
    return formatPaginatedResponse(docs, total, page, limit);
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

      // Earned coins were already debited at request time; record the payout
      await ListenerProfile.updateOne(
        { userId: withdrawal.userId },
        { $inc: { withdrawnAmount: withdrawal.coinsRequested } },
        { session }
      );

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

      // Refund the reserved coins back to the listener's available balance
      await ListenerProfile.updateOne(
        { userId: withdrawal.userId },
        { $inc: { availableBalance: withdrawal.coinsRequested } },
        { session }
      );

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
  async _notify(session, userId, title, body) {
    try {
      await Notification.create([{ recipientId: userId, title, body, type: 'PAYOUT_PROCESSED' }], { session });
    } catch (err) {
      logger.error(`[WithdrawalService] notification failed for ${userId}: ${err.message}`);
    }
  }

  async _invalidate(userId) {
    await Promise.all([
      bumpCacheVersion(CACHE_NS),
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
    ]);
  }
}

export default new WithdrawalService();
