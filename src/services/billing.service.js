import mongoose from 'mongoose';
import redisClient from '../config/redis.js';
import { KEYS, PATTERNS } from '../utils/socket-redis-keys.util.js';
import Wallet from '../modules/wallet.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import SessionSegment from '../modules/session-segment.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import { deleteCache, bumpCacheVersion } from '../utils/redis.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import { emitToSession } from '../utils/socket-room.util.js';
import { getSocketIo } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';

class BillingService {
  /**
   * Global billing cron cycle (runs every 60 seconds).
   * Scans Redis for active sessions and bills them.
   */
  async processBillingCycle(io) {
    if (!redisClient.isRedisAvailable) {
      logger.warn('[Billing Service] Redis offline. Skipping billing cron cycle.');
      return;
    }

    try {
      // Use KEYS command to find active sessions
      const keys = await redisClient.keys(PATTERNS.allActiveSessions);
      if (!keys || keys.length === 0) return;

      const now = new Date();
      logger.info(`[Billing Service] Processing billing cycle for ${keys.length} active sessions.`);

      for (const key of keys) {
        // Extract sessionId from key active_session:{sessionId}
        const sessionId = key.split(':')[1];
        try {
          await this.billSession(sessionId, now, false);
        } catch (err) {
          logger.error(`[Billing Service] Failed billing for session ${sessionId}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`[Billing Service Cycle Error] ${err.message}`);
    }
  }

  /**
   * Calculates and processes the bill for a single session.
   * @param {String} sessionId
   * @param {Date} timePoint - Current time or end time of the session
   * @param {Boolean} isFinal - Whether this is the final bill at session termination (uses Math.ceil)
   */
  async billSession(sessionId, timePoint = new Date(), isFinal = false) {
    let sessionData = null;

    if (redisClient.isRedisAvailable) {
      sessionData = await redisClient.hgetall(KEYS.activeSession(sessionId));
    }

    let callerId, listenerId, ratePerMinute, startTime, segmentId, lastBilledAt;

    if (sessionData && sessionData.callerId) {
      callerId = sessionData.callerId;
      listenerId = sessionData.listenerId;
      ratePerMinute = parseInt(sessionData.ratePerMinute, 10) || 0;
      startTime = new Date(sessionData.startTime);
      lastBilledAt = new Date(sessionData.lastBilledAt);
      segmentId = sessionData.segmentId;
    } else {
      // Fallback to DB if Redis has no data or is offline
      const sessionDoc = await CommunicationSession.findById(sessionId).lean();
      if (!sessionDoc || sessionDoc.status !== 'ONGOING') return;

      const segmentDoc = await SessionSegment.findOne({ sessionId, status: 'ONGOING' }).lean();
      if (!segmentDoc) return;

      callerId = sessionDoc.callerId.toString();
      listenerId = sessionDoc.listenerId.toString();
      ratePerMinute = segmentDoc.ratePerMinute;
      startTime = sessionDoc.startTime;
      lastBilledAt = segmentDoc.updatedAt;
      segmentId = segmentDoc._id.toString();
    }

    // Calculate elapsed duration
    const elapsedSeconds = Math.max(0, Math.floor((timePoint.getTime() - startTime.getTime()) / 1000));

    // Find active segment to check how much was already charged
    const segment = await SessionSegment.findById(segmentId);
    if (!segment || segment.status !== 'ONGOING') {
      logger.warn(`[Billing Service] Session segment ${segmentId} not found or not ongoing.`);
      return;
    }

    const coinsAlreadyCharged = segment.coinsCharged || 0;

    // Calculate total minutes to bill
    // - During the call (cron runs): bill only completed minutes (Math.floor)
    // - At final disconnect: bill completed minutes + remainder (Math.ceil)
    const totalElapsedMinutes = isFinal
      ? Math.ceil(elapsedSeconds / 60)
      : Math.floor(elapsedSeconds / 60);

    const totalCoinsShouldBeCharged = totalElapsedMinutes * ratePerMinute;
    const coinsToCharge = totalCoinsShouldBeCharged - coinsAlreadyCharged;

    if (coinsToCharge <= 0) {
      // Check for low balance warnings even if no charge occurred
      if (!isFinal) {
        await this._checkLowBalanceWarning(callerId, ratePerMinute, sessionId);
      }
      return;
    }

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      // 1. Fetch caller wallet and verify balance
      let callerWallet = await Wallet.findOne({ userId: callerId }).session(dbSession);
      if (!callerWallet) {
        callerWallet = new Wallet({ userId: callerId, coinBalance: 0 });
      }

      let actualCoinsToCharge = coinsToCharge;
      let forceEndSession = false;

      if (callerWallet.coinBalance < coinsToCharge) {
        // Insufficient balance to cover full charge - charge what's left and end session
        actualCoinsToCharge = callerWallet.coinBalance;
        forceEndSession = true;
      }

      if (actualCoinsToCharge > 0) {
        // 2. Debit Caller Wallet
        callerWallet.coinBalance -= actualCoinsToCharge;
        callerWallet.totalSpent = (callerWallet.totalSpent || 0) + actualCoinsToCharge;
        await callerWallet.save({ session: dbSession });

        // 3. Fetch listener profile to apply splitting
        const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).session(dbSession);
        const earningPercent = listenerProfile?.earningPercent || 70; // 70% share defaults to listener
        const listenerShare = Math.floor(actualCoinsToCharge * (earningPercent / 100));

        // 4. Credit Listener Wallet
        let listenerWallet = await Wallet.findOne({ userId: listenerId }).session(dbSession);
        if (!listenerWallet) {
          listenerWallet = new Wallet({ userId: listenerId, coinBalance: 0 });
        }
        listenerWallet.coinBalance += listenerShare;
        listenerWallet.totalEarned = (listenerWallet.totalEarned || 0) + listenerShare;
        await listenerWallet.save({ session: dbSession });

        // 5. Update listener total earnings in profile
        if (listenerProfile) {
          listenerProfile.availableBalance = (listenerProfile.availableBalance || 0) + listenerShare;
          listenerProfile.totalEarnings = (listenerProfile.totalEarnings || 0) + listenerShare;
          await listenerProfile.save({ session: dbSession });
        }

        // 6. Create Caller DEBIT Coin Transaction
        await CoinTransaction.create([{
          userId: callerId,
          type: 'DEBIT',
          amount: actualCoinsToCharge,
          balanceAfter: callerWallet.coinBalance,
          referenceType: 'CHAT',
          referenceId: sessionId,
          description: `Charged for chat session: ${totalElapsedMinutes} mins total`,
        }], { session: dbSession });

        // 7. Create Listener CREDIT Coin Transaction
        await CoinTransaction.create([{
          userId: listenerId,
          type: 'CREDIT',
          amount: listenerShare,
          balanceAfter: listenerWallet.coinBalance,
          referenceType: 'CHAT',
          referenceId: sessionId,
          description: `Earned from chat session: listener share (${earningPercent}%)`,
        }], { session: dbSession });

        // 8. Update SessionSegment coins charged
        segment.coinsCharged = coinsAlreadyCharged + actualCoinsToCharge;
        await segment.save({ session: dbSession });
      }

      // If caller wallet balance goes below next minute threshold, mark termination
      if (callerWallet.coinBalance < ratePerMinute) {
        forceEndSession = true;
      }

      await dbSession.commitTransaction();
      dbSession.endSession();

      // Invalidate caches
      await Promise.all([
        deleteCache(`wallet:user:${callerId}`),
        deleteCache(`wallet:user:${listenerId}`),
        bumpCacheVersion(`coin_transactions:user:${callerId}`),
        bumpCacheVersion(`coin_transactions:user:${listenerId}`),
        bumpCacheVersion('admin:wallets'),
        bumpCacheVersion('admin:coin_transactions'),
      ]);

      // Update lastBilledAt in Redis to prevent double billing
      if (redisClient.isRedisAvailable && !isFinal) {
        await redisClient.hset(KEYS.activeSession(sessionId), 'lastBilledAt', timePoint.toISOString());
      }

      // If balance is critically low, end session or trigger warnings
      if (forceEndSession && !isFinal) {
        logger.info(`[Billing Service] User ${callerId} has insufficient balance. Terminating session ${sessionId}.`);

        const io = getSocketIo();
        if (io) {
          emitToSession(io, sessionId, SERVER_EVENTS.CHAT_ENDED, {
            sessionId,
            reason: 'INSUFFICIENT_BALANCE',
          });
        }

        // Trigger session completion asynchronously
        const { default: communicationSessionService } = await import('./communication-session.service.js');
        await communicationSessionService.endSession(sessionId, 'INSUFFICIENT_BALANCE');
      } else if (!isFinal) {
        // Send low balance warning if caller balance is less than 2 minutes of rate
        await this._checkLowBalanceWarning(callerId, ratePerMinute, sessionId, callerWallet.coinBalance);
      }
    } catch (err) {
      await dbSession.abortTransaction();
      dbSession.endSession();
      logger.error(`[Billing Service billSession Transaction Error] Session ${sessionId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Internal helper to verify wallet and emit warning events if wallet runs low.
   */
  async _checkLowBalanceWarning(callerId, ratePerMinute, sessionId, cachedBalance = null) {
    try {
      let balance = cachedBalance;
      if (balance === null) {
        const wallet = await Wallet.findOne({ userId: callerId }).lean();
        balance = wallet ? wallet.coinBalance : 0;
      }

      // Warn user if balance falls below 2 minutes of conversation (ratePerMinute * 2)
      if (balance < ratePerMinute * 2) {
        const io = getSocketIo();
        if (io) {
          emitToSession(io, sessionId, SERVER_EVENTS.BALANCE_WARNING, {
            sessionId,
            coinBalance: balance,
            message: 'Your coin balance is running low. The chat will disconnect soon.',
          });
        }
      }
    } catch (err) {
      logger.error(`[Billing Warning Check Error] ${err.message}`);
    }
  }
}

export default new BillingService();
