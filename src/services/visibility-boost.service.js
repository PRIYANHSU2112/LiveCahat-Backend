import mongoose from 'mongoose';
import VisibilityBoost from '../modules/visibility-boost.model.js';
import VisibilityBoostConfig from '../modules/visibility-boost-config.model.js';
import visibilityBoostRepository from '../repositories/visibility-boost.repository.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import ApiError from '../utils/ApiError.js';
import { deleteCache, bumpCacheVersion, getCache, setCache } from '../utils/redis.util.js';
import logger from '../utils/logger.util.js';

/** Default config values (used when no admin document exists yet). */
const DEFAULT_CONFIG = {
  isEnabled: true,
  priceCoins: 500,
  durationMinutes: 60,
  maxActiveSlots: 20,
};

class VisibilityBoostService {
  // ──────────────────────────────────────────────────────────────
  // CONFIG
  // ──────────────────────────────────────────────────────────────

  /**
   * Get or create the singleton boost configuration.
   * Cached in Redis for 5 minutes to avoid repeated DB reads on every purchase.
   */
  async getConfig() {
    const cacheKey = 'visibility_boost:config';
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    let config = await VisibilityBoostConfig.findOne().lean();
    if (!config) {
      config = (await VisibilityBoostConfig.create(DEFAULT_CONFIG)).toObject();
    }

    await setCache(cacheKey, config, 300);
    return config;
  }

  /**
   * Admin: Update boost configuration.
   */
  async updateConfig(data) {
    const allowed = {};
    if (typeof data.isEnabled === 'boolean') allowed.isEnabled = data.isEnabled;
    if (data.priceCoins !== undefined) allowed.priceCoins = Number(data.priceCoins);
    if (data.durationMinutes !== undefined) allowed.durationMinutes = Number(data.durationMinutes);
    if (data.maxActiveSlots !== undefined) allowed.maxActiveSlots = Number(data.maxActiveSlots);

    const config = await VisibilityBoostConfig.findOneAndUpdate(
      {},
      { $set: allowed },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    await deleteCache('visibility_boost:config');
    return config;
  }

  // ──────────────────────────────────────────────────────────────
  // PURCHASE
  // ──────────────────────────────────────────────────────────────

  /**
   * Purchase a visibility boost for the authenticated listener.
   *
   * Full atomic flow inside a MongoDB transaction:
   *  1. Idempotency check
   *  2. Config + eligibility guards
   *  3. Expire stale boosts
   *  4. Slot availability check
   *  5. Wallet balance check + debit
   *  6. Sequence allocation
   *  7. Boost + ledger creation
   *  8. Commit
   *
   * @param {string} userId  - Listener's userId
   * @param {string} [idempotencyKey] - Optional client-provided idempotency key
   * @returns {Promise<Object>} Boost result
   */
  async purchase(userId, idempotencyKey) {
    // ── 1. Idempotency: if key already used, return the existing boost ──
    if (idempotencyKey) {
      const existing = await visibilityBoostRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        const wallet = await Wallet.findOne({ userId }).lean();
        return {
          boostId: existing._id,
          sequence: existing.sequence,
          startedAt: existing.startedAt,
          expiresAt: existing.expiresAt,
          amountCoins: existing.amountCoins,
          remainingBalance: wallet?.coinBalance ?? 0,
          idempotent: true,
        };
      }
    }

    // ── 2. Load config (cached) ──
    const config = await this.getConfig();

    if (!config.isEnabled) {
      throw new ApiError(403, 'Visibility boost is currently disabled');
    }

    // ── 3. Listener eligibility (KYC approved, not already boosted) ──
    const listenerProfile = await ListenerProfile.findOne({ userId }).select('kycStatus').lean();
    if (!listenerProfile || listenerProfile.kycStatus !== 'APPROVED') {
      throw new ApiError(403, 'Only KYC-approved listeners can purchase a visibility boost');
    }

    // ── 4. Start transaction ──
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // ── 5. Expire stale boosts inside transaction ──
      await VisibilityBoost.updateMany(
        { status: 'ACTIVE', expiresAt: { $lte: new Date() } },
        { $set: { status: 'EXPIRED' } },
        { session }
      );

      // ── 6. Check listener doesn't already have an active boost ──
      const existingActive = await VisibilityBoost.findOne({
        listenerId: userId,
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      }).session(session);

      if (existingActive) {
        throw new ApiError(409, 'You already have an active visibility boost');
      }

      // ── 7. Count active slots ──
      const activeCount = await VisibilityBoost.countDocuments({
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      }).session(session);

      if (activeCount >= config.maxActiveSlots) {
        throw new ApiError(409, 'All boost slots are currently occupied');
      }

      // ── 8. Wallet balance check + debit ──
      const wallet = await Wallet.findOne({ userId }).session(session);
      if (!wallet) {
        throw new ApiError(400, 'Wallet not found. Please recharge first.');
      }

      if (wallet.coinBalance < config.priceCoins) {
        throw new ApiError(400, 'Insufficient coin balance');
      }

      wallet.coinBalance -= config.priceCoins;
      wallet.totalSpent = (wallet.totalSpent || 0) + config.priceCoins;
      await wallet.save({ session });

      // ── 9. Allocate next sequence ──
      const lastBoost = await VisibilityBoost.findOne({
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      })
        .sort({ sequence: -1 })
        .select('sequence')
        .session(session)
        .lean();

      const sequence = (lastBoost?.sequence || 0) + 1;

      // ── 10. Create boost document ──
      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.durationMinutes * 60 * 1000);

      const [boost] = await VisibilityBoost.create(
        [
          {
            listenerId: userId,
            status: 'ACTIVE',
            amountCoins: config.priceCoins,
            sequence,
            startedAt: now,
            expiresAt,
            idempotencyKey: idempotencyKey || undefined,
          },
        ],
        { session }
      );

      // ── 11. Create CoinTransaction ledger entry ──
      const [coinTx] = await CoinTransaction.create(
        [
          {
            userId,
            type: 'DEBIT',
            amount: config.priceCoins,
            balanceAfter: wallet.coinBalance,
            referenceType: 'VISIBILITY_BOOST',
            referenceId: boost._id,
            description: `Visibility boost purchase (${config.durationMinutes} min)`,
          },
        ],
        { session }
      );

      // Link transaction back to boost
      boost.transactionId = coinTx._id;
      await boost.save({ session });

      // ── 12. Commit ──
      await session.commitTransaction();
      session.endSession();

      // ── 13. Post-commit cache invalidation (fire-and-forget) ──
      const userIdStr = userId.toString();
      Promise.all([
        deleteCache(`wallet:user:${userIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${userIdStr}`),
        bumpCacheVersion('listeners'),
        bumpCacheVersion('admin:wallets'),
        bumpCacheVersion('admin:coin_transactions'),
      ]).catch((err) =>
        logger.error(`[VisibilityBoost] Cache invalidation error: ${err.message}`)
      );

      return {
        boostId: boost._id,
        sequence: boost.sequence,
        startedAt: boost.startedAt,
        expiresAt: boost.expiresAt,
        amountCoins: boost.amountCoins,
        remainingBalance: wallet.coinBalance,
      };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────

  /**
   * Get the listener's current active boost (if any).
   */
  async getMyBoost(userId) {
    const boost = await VisibilityBoost.findOne({
      listenerId: userId,
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!boost) return null;

    return {
      boostId: boost._id,
      sequence: boost.sequence,
      startedAt: boost.startedAt,
      expiresAt: boost.expiresAt,
      amountCoins: boost.amountCoins,
      status: boost.status,
    };
  }

  /**
   * Get all currently active boosts (admin/debug).
   */
  async getActiveBoosts() {
    return await VisibilityBoost.find({
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    })
      .sort({ sequence: 1 })
      .populate('listenerId', 'firstName lastName profileImage')
      .lean();
  }

  // ──────────────────────────────────────────────────────────────
  // EXPIRY (called by cron)
  // ──────────────────────────────────────────────────────────────

  /**
   * Mark all expired boosts as EXPIRED and invalidate the home feed cache.
   * @returns {Promise<number>} Number of boosts expired
   */
  async expireStaleBoosts() {
    const count = await visibilityBoostRepository.markExpired();
    if (count > 0) {
      await bumpCacheVersion('listeners');
      logger.info(`[VisibilityBoost] Expired ${count} stale boost(s)`);
    }
    return count;
  }
}

export default new VisibilityBoostService();
