import mongoose from 'mongoose';
import redisClient from '../config/redis.js';
import { KEYS, PATTERNS } from '../utils/socket-redis-keys.util.js';
import Wallet from '../modules/wallet.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import LiveRoom from '../modules/live-room.model.js';
import { deleteCache, bumpCacheVersion } from '../utils/redis.util.js';
import { emitToUser, getSocketIo } from '../utils/socket.util.js';
import { emitToLiveRoom } from '../utils/socket-room.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import logger from '../utils/logger.util.js';
import anchorLevelService from './anchor-level.service.js';

/**
 * LiveBillingService — per-minute coin billing for live room viewers.
 *
 * Mirrors the proven patterns from billing.service.js (1-on-1 calls):
 * - Redis hash stores per-viewer billing state (joinedAt, coinsCharged, etc.)
 * - 60-second cron calls processLiveBillingCycle() to charge completed minutes
 * - Final billing on leave/disconnect/room-end uses Math.ceil for partial minutes
 * - Atomic MongoDB transactions for wallet debit/credit + immutable ledger records
 * - Idempotency via coinsCharged tracking to prevent double deductions
 */
class LiveBillingService {
  // ─── Start / Stop viewer billing ─────────────────────────────────────────

  /**
   * Begin billing for a viewer who just joined a live room.
   * If a billing hash already exists (reconnect), billing continues seamlessly.
   *
   * @param {String} roomId
   * @param {String} userId     - The viewer's userId
   * @param {String} hostId     - The room host's userId (listener)
   * @param {Number} liveRate   - Coins per minute
   * @param {Number} earningPercent - Host earning share (e.g. 70)
   */
  async startViewerBilling(roomId, userId, hostId, liveRate, earningPercent) {
    if (!redisClient.isRedisAvailable || liveRate <= 0) return;

    const billingKey = KEYS.liveRoomViewerBilling(roomId, userId);

    // Reconnect guard: if billing hash exists, do nothing (billing continues)
    const existing = await redisClient.hget(billingKey, 'joinedAt');
    if (existing) {
      logger.info(`[LiveBilling] Viewer ${userId} reconnected to room ${roomId} — billing continues.`);
      return;
    }

    const now = new Date().toISOString();
    await redisClient.hset(billingKey, {
      joinedAt: now,
      lastBilledAt: now,
      coinsCharged: '0',
      liveRate: String(liveRate),
      earningPercent: String(earningPercent),
      hostId,
      roomId,
    });

    // Add room to active billing set for cron scan
    await redisClient.sadd(KEYS.liveRoomBillingSet(), roomId);

    logger.info(`[LiveBilling] Started billing for viewer ${userId} in room ${roomId} (${liveRate} coins/min).`);
  }

  /**
   * Stop billing for a viewer (leave / disconnect / kick).
   * Performs a final ceil-based charge and cleans up Redis.
   *
   * @param {String} roomId
   * @param {String} userId
   */
  async stopViewerBilling(roomId, userId) {
    if (!redisClient.isRedisAvailable) return;

    const billingKey = KEYS.liveRoomViewerBilling(roomId, userId);
    const billingData = await redisClient.hgetall(billingKey);

    if (!billingData || !billingData.joinedAt) return;

    try {
      // Final billing with Math.ceil for partial minutes
      await this.billViewer(roomId, userId, new Date(), true, billingData);
    } catch (err) {
      logger.error(`[LiveBilling] Final bill failed for viewer ${userId} room ${roomId}: ${err.message}`);
    }

    // Clean up Redis billing hash
    await redisClient.del(billingKey);

    // Check if room still has billing viewers; if not, remove from set
    await this._cleanupRoomFromBillingSet(roomId);

    logger.info(`[LiveBilling] Stopped billing for viewer ${userId} in room ${roomId}.`);
  }

  // ─── Core billing logic ──────────────────────────────────────────────────

  /**
   * Calculate and process the bill for a single viewer in a live room.
   * Mirrors billing.service.js billSession() pattern.
   *
   * @param {String}  roomId
   * @param {String}  userId
   * @param {Date}    timePoint  - Current time or end time
   * @param {Boolean} isFinal    - true = ceil partial minutes (leave/end), false = floor (cron)
   * @param {Object}  [cachedData] - Optional pre-fetched billing hash (avoids extra Redis read)
   */
  async billViewer(roomId, userId, timePoint = new Date(), isFinal = false, cachedData = null) {
    let billingData = cachedData;
    if (!billingData) {
      if (!redisClient.isRedisAvailable) return;
      billingData = await redisClient.hgetall(KEYS.liveRoomViewerBilling(roomId, userId));
    }

    if (!billingData || !billingData.joinedAt) return;

    const liveRate = parseInt(billingData.liveRate, 10) || 0;
    if (liveRate <= 0) return;

    const hostId = billingData.hostId;
    const earningPercent = parseInt(billingData.earningPercent, 10) || 70;
    const joinedAt = new Date(billingData.joinedAt);
    const coinsAlreadyCharged = parseInt(billingData.coinsCharged, 10) || 0;

    // Calculate elapsed duration since join
    const elapsedSeconds = Math.max(0, Math.floor((timePoint.getTime() - joinedAt.getTime()) / 1000));

    // Floor during cron (charge completed minutes), ceil on final (charge partial)
    const totalElapsedMinutes = isFinal
      ? Math.ceil(elapsedSeconds / 60)
      : Math.floor(elapsedSeconds / 60);

    const totalCoinsShouldBeCharged = totalElapsedMinutes * liveRate;
    const coinsToCharge = totalCoinsShouldBeCharged - coinsAlreadyCharged;

    if (coinsToCharge <= 0) {
      // Still check for low balance warning during cron
      if (!isFinal) {
        await this._checkLowBalanceWarning(userId, liveRate, roomId);
      }
      return;
    }

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      // 1. Fetch viewer wallet and verify balance
      let viewerWallet = await Wallet.findOne({ userId }).session(dbSession);
      if (!viewerWallet) {
        viewerWallet = new Wallet({ userId, coinBalance: 0 });
      }

      let actualCoinsToCharge = coinsToCharge;
      let forceKick = false;

      if (viewerWallet.coinBalance < coinsToCharge) {
        // Insufficient balance: charge what's left and kick
        actualCoinsToCharge = viewerWallet.coinBalance;
        forceKick = true;
      }

      if (actualCoinsToCharge > 0) {
        // 2. Debit viewer wallet
        viewerWallet.coinBalance -= actualCoinsToCharge;
        viewerWallet.totalSpent = (viewerWallet.totalSpent || 0) + actualCoinsToCharge;
        await viewerWallet.save({ session: dbSession });

        // 3. Calculate host share
        const listenerProfile = await ListenerProfile.findOne({ userId: hostId }).session(dbSession);
        const hostShare = Math.floor(actualCoinsToCharge * (earningPercent / 100));

        // 4. Credit host wallet
        let hostWallet = await Wallet.findOne({ userId: hostId }).session(dbSession);
        if (!hostWallet) {
          hostWallet = new Wallet({ userId: hostId, coinBalance: 0 });
        }
        hostWallet.coinBalance += hostShare;
        hostWallet.totalEarned = (hostWallet.totalEarned || 0) + hostShare;
        await hostWallet.save({ session: dbSession });

        // 5. Update listener profile earnings
        if (listenerProfile) {
          listenerProfile.availableBalance = (listenerProfile.availableBalance || 0) + hostShare;
          listenerProfile.totalEarnings = (listenerProfile.totalEarnings || 0) + hostShare;
          await listenerProfile.save({ session: dbSession });
        }

        // 6. Create viewer DEBIT ledger entry
        await CoinTransaction.create([{
          userId,
          type: 'DEBIT',
          amount: actualCoinsToCharge,
          balanceAfter: viewerWallet.coinBalance,
          referenceType: 'LIVE_ROOM',
          referenceId: roomId,
          description: `Charged for watching live room: ${totalElapsedMinutes} mins total`,
        }], { session: dbSession });

        // 7. Create host CREDIT ledger entry
        await CoinTransaction.create([{
          userId: hostId,
          type: 'CREDIT',
          amount: hostShare,
          balanceAfter: hostWallet.coinBalance,
          referenceType: 'LIVE_ROOM',
          referenceId: roomId,
          description: `Earned from live room viewer: host share (${earningPercent}%)`,
        }], { session: dbSession });

        // 8. Update LiveRoom aggregate billing totals
        await LiveRoom.updateOne(
          { _id: roomId },
          {
            $inc: {
              totalCoinsCollected: actualCoinsToCharge,
              totalCoinsEarned: hostShare,
            },
          },
          { session: dbSession }
        );
      }

      // If viewer wallet below next minute threshold, mark for kick
      if (viewerWallet.coinBalance < liveRate) {
        forceKick = true;
      }

      await dbSession.commitTransaction();
      dbSession.endSession();

      // 9. Invalidate caches
      await Promise.all([
        deleteCache(`wallet:user:${userId}`),
        deleteCache(`wallet:user:${hostId}`),
        bumpCacheVersion(`coin_transactions:user:${userId}`),
        bumpCacheVersion(`coin_transactions:user:${hostId}`),
        bumpCacheVersion('admin:wallets'),
        bumpCacheVersion('admin:coin_transactions'),
      ]);

      // 10. Update Redis billing state
      if (redisClient.isRedisAvailable && !isFinal) {
        const billingKey = KEYS.liveRoomViewerBilling(roomId, userId);
        await redisClient.hset(billingKey, {
          coinsCharged: String(coinsAlreadyCharged + actualCoinsToCharge),
          lastBilledAt: timePoint.toISOString(),
        });
      }

      // Re-evaluate host anchor level after earnings (fire-and-forget)
      anchorLevelService.evaluateAnchorLevel(hostId).catch((err) =>
        logger.error(`[LiveBilling] anchor eval failed for ${hostId}: ${err.message}`)
      );

      // 11. Handle force kick or low balance warning
      if (forceKick && !isFinal) {
        await this._kickViewerInsufficientBalance(roomId, userId);
      } else if (!isFinal) {
        await this._checkLowBalanceWarning(userId, liveRate, roomId, viewerWallet.coinBalance);
      }
    } catch (err) {
      await dbSession.abortTransaction();
      dbSession.endSession();
      logger.error(`[LiveBilling] Transaction error for viewer ${userId} room ${roomId}: ${err.message}`);
      throw err;
    }
  }

  // ─── Cron cycle ──────────────────────────────────────────────────────────

  /**
   * Global live billing cron cycle (called every 60 seconds by billing.job.js).
   * Iterates the active rooms set, then scans viewer billing hashes per room.
   */
  async processLiveBillingCycle() {
    if (!redisClient.isRedisAvailable) return;

    try {
      const activeRooms = await redisClient.smembers(KEYS.liveRoomBillingSet());
      if (!activeRooms || activeRooms.length === 0) return;

      const now = new Date();
      logger.info(`[LiveBilling] Processing billing cycle for ${activeRooms.length} active live rooms.`);

      for (const roomId of activeRooms) {
        try {
          await this._billRoomViewers(roomId, now, false);
        } catch (err) {
          logger.error(`[LiveBilling] Failed billing for room ${roomId}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`[LiveBilling Cycle Error] ${err.message}`);
    }
  }

  /**
   * Bill all active viewers in a single room.
   */
  async _billRoomViewers(roomId, timePoint, isFinal) {
    const pattern = PATTERNS.liveRoomBillingViewers(roomId);
    const keys = await redisClient.keys(pattern);

    if (!keys || keys.length === 0) {
      // No active viewers — clean up room from billing set
      await redisClient.srem(KEYS.liveRoomBillingSet(), roomId);
      return;
    }

    for (const key of keys) {
      // Extract userId from key: live_billing:{roomId}:{userId}
      const parts = key.split(':');
      const userId = parts[parts.length - 1];

      try {
        if (isFinal) {
          await this.stopViewerBilling(roomId, userId);
        } else {
          await this.billViewer(roomId, userId, timePoint, false);
        }
      } catch (err) {
        logger.error(`[LiveBilling] Failed billing viewer ${userId} in room ${roomId}: ${err.message}`);
      }
    }
  }

  // ─── Room-level settlement ───────────────────────────────────────────────

  /**
   * Final settlement for all viewers in a room (called on live:end or orphan cleanup).
   * Charges partial minutes (ceil) and cleans up all Redis billing state.
   */
  async reconcileRoomBilling(roomId) {
    if (!redisClient.isRedisAvailable) return;

    logger.info(`[LiveBilling] Reconciling billing for room ${roomId}...`);

    try {
      await this._billRoomViewers(roomId, new Date(), true);
    } catch (err) {
      logger.error(`[LiveBilling] Reconcile failed for room ${roomId}: ${err.message}`);
    }

    // Final cleanup: remove room from billing set
    await redisClient.srem(KEYS.liveRoomBillingSet(), roomId);
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  /**
   * Check if a room still has billing viewers; if not, remove from active set.
   */
  async _cleanupRoomFromBillingSet(roomId) {
    if (!redisClient.isRedisAvailable) return;

    const pattern = PATTERNS.liveRoomBillingViewers(roomId);
    const keys = await redisClient.keys(pattern);

    if (!keys || keys.length === 0) {
      await redisClient.srem(KEYS.liveRoomBillingSet(), roomId);
    }
  }

  /**
   * Kick a viewer from the live room due to insufficient balance.
   */
  async _kickViewerInsufficientBalance(roomId, userId) {
    logger.info(`[LiveBilling] Kicking viewer ${userId} from room ${roomId} — insufficient balance.`);

    // Clean up billing state
    const billingKey = KEYS.liveRoomViewerBilling(roomId, userId);
    await redisClient.del(billingKey);
    await this._cleanupRoomFromBillingSet(roomId);

    const io = getSocketIo();
    if (io) {
      // Notify viewer they were kicked
      emitToUser(userId, 'live:kicked', {
        roomId,
        reason: 'INSUFFICIENT_BALANCE',
        message: 'You have been removed from the live room due to insufficient coin balance.',
      });
    }

    // Remove viewer from room tracking
    const { default: liveRoomService } = await import('./live-room.service.js');
    const viewerCount = await liveRoomService.removeViewer(roomId, userId);

    // Broadcast updated viewer count
    if (io) {
      emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_VIEWER_COUNT_UPDATE, {
        roomId,
        viewerCount,
      });
    }
  }

  /**
   * Emit low balance warning to a specific viewer.
   */
  async _checkLowBalanceWarning(userId, liveRate, roomId, cachedBalance = null) {
    try {
      let balance = cachedBalance;
      if (balance === null) {
        const wallet = await Wallet.findOne({ userId }).lean();
        balance = wallet ? wallet.coinBalance : 0;
      }

      // Warn if balance < 2 minutes of viewing
      if (balance < liveRate * 2) {
        emitToUser(userId, 'live:balance_warning', {
          roomId,
          coinBalance: balance,
          message: 'Your coin balance is running low. You will be removed from the live room soon.',
        });
      }
    } catch (err) {
      logger.error(`[LiveBilling Warning] ${err.message}`);
    }
  }
}

export default new LiveBillingService();
