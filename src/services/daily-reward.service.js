import mongoose from 'mongoose';
import DailyRewardState from '../modules/daily-reward-state.model.js';
import DailyRewardClaimLog from '../modules/daily-reward-claim-log.model.js';
import DailyRewardConfig from '../modules/daily-reward-config.model.js';
import WeeklySpecialGiftConfig from '../modules/weekly-special-gift-config.model.js';
import UserGiftInventory from '../modules/user-gift-inventory.model.js';
import Gift from '../modules/gift.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { emitToUser } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';
import xpService from './xp.service.js';

const CONFIG_CACHE_KEY = 'daily_rewards:config';
const GIFT_POPULATE = { path: 'giftId', select: 'name icon coin isActive category' };
const USER_POPULATE = { path: 'userId', select: 'firstName lastName profileImage' };

// ========================================================
// Helper Utilities for UTC Date Calculations
// ========================================================

const getUTCMidnight = (date) => {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const getCalendarDaysDifference = (date1, date2) => {
  if (!date1 || !date2) return null;
  const midnight1 = getUTCMidnight(date1);
  const midnight2 = getUTCMidnight(date2);
  return Math.round((midnight1 - midnight2) / (1000 * 60 * 60 * 24));
};

const getUTCDateString = (date) => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

class DailyRewardService {
  /**
   * Automatically seeds default configurations if they do not exist on system boot.
   */
  async seedDefaultConfig() {
    try {
      // 1. Seed chests (Gifts) if they do not exist
      const defaultChests = [
        { name: 'Bronze Mystery Chest', coin: 200, category: 'SPECIAL', icon: 'https://cdn-icons-png.flaticon.com/512/3082/3082060.png', isActive: true, description: 'Contains starter rewards.' },
        { name: 'Silver Mystery Chest', coin: 500, category: 'SPECIAL', icon: 'https://cdn-icons-png.flaticon.com/512/3082/3082066.png', isActive: true, description: 'Contains standard rewards.' },
        { name: 'Gold Mystery Chest', coin: 1000, category: 'SPECIAL', icon: 'https://cdn-icons-png.flaticon.com/512/3082/3082071.png', isActive: true, description: 'Contains premium rewards.' },
        { name: 'Diamond Mystery Chest', coin: 2500, category: 'SPECIAL', icon: 'https://cdn-icons-png.flaticon.com/512/3082/3082076.png', isActive: true, description: 'Contains ultimate rewards.' }
      ];

      const chestDocs = {};
      for (const chest of defaultChests) {
        let doc = await Gift.findOne({ name: chest.name });
        if (!doc) {
          doc = await Gift.create(chest);
          logger.info(`[DailyRewardService] Seeded gift: ${chest.name}`);
        }
        chestDocs[chest.name] = doc._id;
      }

      // 2. Seed Weekly Special Gift Configurations (Weeks 1 to 4)
      const weeklyConfigDefaults = [
        { week: 1, giftId: chestDocs['Bronze Mystery Chest'] },
        { week: 2, giftId: chestDocs['Silver Mystery Chest'] },
        { week: 3, giftId: chestDocs['Gold Mystery Chest'] },
        { week: 4, giftId: chestDocs['Diamond Mystery Chest'] }
      ];

      for (const wConfig of weeklyConfigDefaults) {
        const exists = await WeeklySpecialGiftConfig.findOne({ week: wConfig.week });
        if (!exists) {
          await WeeklySpecialGiftConfig.create(wConfig);
          logger.info(`[DailyRewardService] Seeded weekly config for Week ${wConfig.week}`);
        }
      }

      // 3. Seed Daily Reward Configurations (Days 1 to 7)
      const dailyConfigDefaults = [
        { day: 1, rewardType: 'COINS', rewardValue: 100 },
        { day: 2, rewardType: 'COINS', rewardValue: 110 },
        { day: 3, rewardType: 'COINS', rewardValue: 120 },
        { day: 4, rewardType: 'COINS', rewardValue: 130 },
        { day: 5, rewardType: 'COINS', rewardValue: 140 },
        { day: 6, rewardType: 'COINS', rewardValue: 150 },
        { day: 7, rewardType: 'WEEKLY_SPECIAL_GIFT' }
      ];

      for (const dConfig of dailyConfigDefaults) {
        const exists = await DailyRewardConfig.findOne({ day: dConfig.day });
        if (!exists) {
          await DailyRewardConfig.create(dConfig);
          logger.info(`[DailyRewardService] Seeded daily config for Day ${dConfig.day}`);
        }
      }

      await deleteCache(CONFIG_CACHE_KEY);
    } catch (err) {
      logger.error(`[DailyRewardService Seed Error] ${err.message}`);
    }
  }

  /**
   * Build MongoDB filter for claimDate string field (YYYY-MM-DD) from year/month/day params.
   */
  _buildClaimDateFilter({ year, month, day } = {}) {
    if (!year) return {};

    const y = parseInt(year, 10);
    if (month && day) {
      const m = String(parseInt(month, 10)).padStart(2, '0');
      const d = String(parseInt(day, 10)).padStart(2, '0');
      return { claimDate: `${y}-${m}-${d}` };
    }
    if (month) {
      const m = parseInt(month, 10);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const mm = String(m).padStart(2, '0');
      return {
        claimDate: {
          $gte: `${y}-${mm}-01`,
          $lte: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
        },
      };
    }
    return {
      claimDate: {
        $gte: `${y}-01-01`,
        $lte: `${y}-12-31`,
      },
    };
  }

  async _loadConfigFromDb() {
    const [dayConfigs, weekConfigs] = await Promise.all([
      DailyRewardConfig.find().sort({ day: 1 }).populate(GIFT_POPULATE).lean(),
      WeeklySpecialGiftConfig.find().sort({ week: 1 }).populate(GIFT_POPULATE).lean(),
    ]);
    return { dayConfigs, weekConfigs };
  }

  /**
   * Admin: Get full day + week reward configuration (cached).
   */
  async getAdminConfig() {
    let configs = await getCache(CONFIG_CACHE_KEY);
    if (!configs) {
      configs = await this._loadConfigFromDb();
      await setCache(CONFIG_CACHE_KEY, configs, 3600);
    }
    return configs;
  }

  /**
   * Admin: Platform KPIs with optional year/month/day scope on claim metrics.
   */
  async getAdminStats(query = {}) {
    const { year, month, day } = query;
    const cacheKey = `daily_rewards:admin:stats:${year || 'all'}:${month || 'all'}:${day || 'all'}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const dateFilter = this._buildClaimDateFilter(query);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const now = new Date();
    const todayString = getUTCDateString(now);
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
    const yesterday = new Date(startOfToday);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const [
      totalClaims,
      claimsToday,
      claimsThisWeek,
      activeStreaks,
      totalUsersWithState,
      coinsAgg,
      giftsInPeriod,
    ] = await Promise.all([
      DailyRewardClaimLog.countDocuments(dateFilter),
      DailyRewardClaimLog.countDocuments({ claimDate: todayString }),
      hasDateFilter
        ? Promise.resolve(null)
        : DailyRewardClaimLog.countDocuments({ claimedAt: { $gte: startOfWeek } }),
      DailyRewardState.countDocuments({ lastClaimedAt: { $gte: yesterday } }),
      DailyRewardState.countDocuments(),
      DailyRewardClaimLog.aggregate([
        { $match: { ...dateFilter, rewardType: 'COINS' } },
        { $group: { _id: null, total: { $sum: { $toDouble: '$rewardValue' } } } },
      ]),
      DailyRewardClaimLog.countDocuments({ ...dateFilter, rewardType: 'GIFT' }),
    ]);

    const stats = {
      totalClaims,
      claimsToday,
      claimsThisWeek: hasDateFilter ? undefined : claimsThisWeek,
      claimsInPeriod: hasDateFilter ? totalClaims : undefined,
      activeStreaks,
      totalUsersWithState,
      coinsGrantedInPeriod: coinsAgg[0]?.total ?? 0,
      giftsClaimedInPeriod: giftsInPeriod,
      filter: hasDateFilter
        ? {
            year: parseInt(year, 10),
            month: month ? parseInt(month, 10) : null,
            day: day ? parseInt(day, 10) : null,
          }
        : null,
    };

    await setCache(cacheKey, stats, 60);
    return stats;
  }

  /**
   * Admin: Paginated claim audit log.
   */
  async getAdminClaims(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'claimedAt',
      sortOrder: query.sortOrder || 'desc',
      ...query,
    });

    const filter = this._buildClaimDateFilter(query);
    if (query.userId) filter.userId = query.userId;
    if (query.rewardType) filter.rewardType = query.rewardType;

    const [docs, total] = await Promise.all([
      DailyRewardClaimLog.find(filter)
        .populate(USER_POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      DailyRewardClaimLog.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  /**
   * Admin: Clear configuration cache.
   */
  async clearCache() {
    await deleteCache(CONFIG_CACHE_KEY);
    await bumpCacheVersion('daily_rewards');
    return { success: true };
  }

  /**
   * Retrieves the user's daily reward status and calculations.
   * Also returns the full configured cycle details for client UI rendering.
   */
  async getDailyRewardState(userId, nowOverride = null) {
    // 1. Fetch user state
    let state = await DailyRewardState.findOne({ userId });
    if (!state) {
      state = await DailyRewardState.create({
        userId,
        lastClaimedAt: null,
        lastClaimedDay: 0,
        specialGiftWeek: 1,
      });
    }

    const now = nowOverride ? new Date(nowOverride) : new Date();
    let isClaimedToday = false;
    let nextDayToClaim = 1;

    if (state.lastClaimedAt) {
      const diffDays = getCalendarDaysDifference(now, state.lastClaimedAt);
      if (diffDays === 0) {
        isClaimedToday = true;
        nextDayToClaim = state.lastClaimedDay === 7 ? 1 : state.lastClaimedDay + 1;
      } else if (diffDays === 1) {
        isClaimedToday = false;
        nextDayToClaim = state.lastClaimedDay === 7 ? 1 : state.lastClaimedDay + 1;
      } else {
        // Streak broken (>1 calendar day missed)
        isClaimedToday = false;
        nextDayToClaim = 1;
      }
    }

    // 2. Fetch full configurations (with populated gifts) for preview
    const cacheKey = CONFIG_CACHE_KEY;
    let configs = await getCache(cacheKey);
    if (!configs) {
      const dayConfigs = await DailyRewardConfig.find().sort({ day: 1 }).populate('giftId').lean();
      const weekConfigs = await WeeklySpecialGiftConfig.find().sort({ week: 1 }).populate('giftId').lean();
      configs = { dayConfigs, weekConfigs };
      await setCache(cacheKey, configs, 3600); // Cache for 1 hour
    }

    // 3. Resolve what special gift they are currently tracking
    const currentWeekConfig = configs.weekConfigs.find(w => w.week === state.specialGiftWeek);
    // const trackingSpecialGift = currentWeekConfig ? currentWeekConfig.giftId : null;

    return {
      streakState: {
        lastClaimedDay: state.lastClaimedDay,
        lastClaimedAt: state.lastClaimedAt,
        specialGiftWeek: state.specialGiftWeek,
        isClaimedToday,
        nextDayToClaim,
        // trackingSpecialGift
      },
      rewardsConfig: configs.dayConfigs.map(day => {
        if (day.day === 7) {
          // Dynamically map week's gift to day 7 preview based on current state.specialGiftWeek
          return {
            ...day,
            rewardType: 'GIFT',
            // giftId: trackingSpecialGift
          };
        }
        return day;
      }),
      // weeklySpecialGifts: configs.weekConfigs
    };
  }

  /**
   * Executes a reward claim for the user, applying state updates, wallets additions,
   * inventory increments and claim logging inside a safe database transaction.
   */
  async claimDailyReward(userId, nowOverride = null) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Lock/Fetch DailyRewardState
      let state = await DailyRewardState.findOne({ userId }).session(session);
      if (!state) {
        state = new DailyRewardState({
          userId,
          lastClaimedAt: null,
          lastClaimedDay: 0,
          specialGiftWeek: 1,
        });
        await state.save({ session });
      }

      const now = nowOverride ? new Date(nowOverride) : new Date();
      const todayString = getUTCDateString(now);

      // 2. Calculate next day to claim
      let targetDay = 1;
      if (state.lastClaimedAt) {
        const diffDays = getCalendarDaysDifference(now, state.lastClaimedAt);
        if (diffDays === 0) {
          throw new ApiError(400, 'Daily reward already claimed today. Please try again tomorrow.');
        } else if (diffDays === 1) {
          targetDay = state.lastClaimedDay === 7 ? 1 : state.lastClaimedDay + 1;
        } else {
          // Streak broken
          targetDay = 1;
        }
      }

      // 3. Create DailyRewardClaimLog (Strict gatekeeper for race conditions)
      let claimLog;
      try {
        claimLog = new DailyRewardClaimLog({
          userId,
          claimDate: todayString,
          dayClaimed: targetDay,
          rewardType: 'COINS', // Default, will change below
          rewardValue: 0,
          claimedAt: now,
        });
        await claimLog.save({ session });
      } catch (err) {
        // Unique index collision: userId + claimDate already exists
        if (err.code === 11000) {
          throw new ApiError(400, 'Daily reward already claimed today. Duplicate claim rejected.');
        }
        throw err;
      }

      // 4. Resolve reward config for targetDay
      const config = await DailyRewardConfig.findOne({ day: targetDay }).session(session);
      if (!config) {
        throw new ApiError(500, `Reward configuration for Day ${targetDay} not found.`);
      }

      let rewardSummary = {};

      if (config.rewardType === 'COINS') {
        // CREDIT user wallet
        let wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) {
          wallet = new Wallet({ userId, coinBalance: 0 });
        }
        wallet.coinBalance += config.rewardValue;
        wallet.totalEarned = (wallet.totalEarned || 0) + config.rewardValue;
        await wallet.save({ session });

        // Coin Ledger entry
        await CoinTransaction.create([{
          userId,
          type: 'CREDIT',
          amount: config.rewardValue,
          balanceAfter: wallet.coinBalance,
          referenceType: 'BONUS',
          description: `Daily login reward claimed - Day ${targetDay}`
        }], { session });

        // Update Log Details
        claimLog.rewardType = 'COINS';
        claimLog.rewardValue = config.rewardValue;
        await claimLog.save({ session });

        rewardSummary = { type: 'COINS', value: config.rewardValue };

      } else if (config.rewardType === 'GIFT') {
        // Resolve static Gift reward
        const gift = await Gift.findById(config.giftId).session(session);
        if (!gift || !gift.isActive) {
          throw new ApiError(404, 'Configured gift reward is currently unavailable or inactive.');
        }

        // Add to user gift inventory
        await this._creditGiftToInventory(userId, gift._id, session);

        // Record gift transaction ledger
        await GiftTransaction.create([{
          giftId: gift._id,
          senderId: userId, // Self-claimed
          receiverId: userId,
          coins: gift.coin,
          earningPercent: gift.earningPercent,
          adminPercent: gift.adminPercent,
          earningCoins: 0,
          adminCoins: gift.coin,
          type: 'ADMIN_TO_USER',
          status: 'SUCCESS'
        }], { session });

        // Update Log Details
        claimLog.rewardType = 'GIFT';
        claimLog.rewardValue = gift.name;
        await claimLog.save({ session });

        rewardSummary = { type: 'GIFT', value: gift.name, gift };

      } else if (config.rewardType === 'WEEKLY_SPECIAL_GIFT') {
        // Resolve Weekly Chest
        const currentWeek = state.specialGiftWeek;
        const weekConfig = await WeeklySpecialGiftConfig.findOne({ week: currentWeek }).session(session);
        if (!weekConfig) {
          throw new ApiError(500, `Weekly special gift configuration for Week ${currentWeek} not found.`);
        }

        const gift = await Gift.findById(weekConfig.giftId).session(session);
        if (!gift || !gift.isActive) {
          throw new ApiError(404, `Weekly chest "${gift?.name || 'Chest'}" is currently unavailable.`);
        }

        // Add to user gift inventory
        await this._creditGiftToInventory(userId, gift._id, session);

        // Record gift transaction ledger
        await GiftTransaction.create([{
          giftId: gift._id,
          senderId: userId,
          receiverId: userId,
          coins: gift.coin,
          earningPercent: gift.earningPercent,
          adminPercent: gift.adminPercent,
          earningCoins: 0,
          adminCoins: gift.coin,
          type: 'ADMIN_TO_USER',
          status: 'SUCCESS'
        }], { session });

        // Update Log Details
        claimLog.rewardType = 'GIFT';
        claimLog.rewardValue = gift.name;
        await claimLog.save({ session });

        rewardSummary = { type: 'GIFT', value: gift.name, gift };

        // Advance special gift progression week (1-4, wraps back to 1)
        state.specialGiftWeek = (currentWeek % 4) + 1;
      }

      // 5. Update user state
      state.lastClaimedDay = targetDay;
      state.lastClaimedAt = now;
      await state.save({ session });

      await session.commitTransaction();
      session.endSession();

      // 6. Caches invalidation
      await Promise.all([
        deleteCache(`wallet:user:${userId}`),
        bumpCacheVersion(`coin_transactions:user:${userId}`),
        bumpCacheVersion('admin:wallets')
      ]);

      // 7. Emit Socket Notification
      emitToUser(userId.toString(), 'daily_reward:claimed', {
        dayClaimed: targetDay,
        reward: rewardSummary,
        claimedAt: now
      });

      return {
        success: true,
        message: `Successfully claimed Day ${targetDay} reward!`,
        claimedDay: targetDay,
        reward: rewardSummary,
        streakState: {
          lastClaimedDay: state.lastClaimedDay,
          lastClaimedAt: state.lastClaimedAt,
          specialGiftWeek: state.specialGiftWeek,
        }
      };

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    } finally {
      // Fire-and-forget XP awards (outside transaction, never fails the claim)
      try {
        await xpService.awardXp(userId, 'DAILY_LOGIN');
        if (targetDay > 1) {
          await xpService.awardXp(userId, 'DAILY_STREAK_BONUS');
        }
      } catch (xpErr) {
        logger.error(`[DailyReward XP] Failed to award XP: ${xpErr.message}`);
      }
    }
  }

  /**
   * Retrieves the user's current inventory of claimed/received gifts and chests.
   */
  async getUserInventory(userId) {
    return await UserGiftInventory.find({ userId }).populate('giftId');
  }

  /**
   * Admin: Updates the configuration for the 7 days cycle.
   */
  async updateDaysConfig(configs) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      for (const item of configs) {
        const update = { rewardType: item.rewardType };
        if (item.rewardType === 'COINS') {
          update.rewardValue = item.rewardValue ?? 0;
          update.giftId = null;
        } else if (item.rewardType === 'GIFT') {
          update.rewardValue = 0;
          update.giftId = item.giftId || null;
        } else if (item.rewardType === 'WEEKLY_SPECIAL_GIFT') {
          update.rewardValue = 0;
          update.giftId = null;
        }
        await DailyRewardConfig.findOneAndUpdate(
          { day: item.day },
          update,
          { session, new: true, runValidators: true }
        );
      }
      await session.commitTransaction();
      session.endSession();

      await deleteCache(CONFIG_CACHE_KEY);
      await bumpCacheVersion('daily_rewards');
      return { success: true, message: '7 days reward configuration updated successfully.' };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  /**
   * Admin: Updates the configuration for the 4-week special gift cycle.
   */
  async updateWeeksConfig(configs) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      for (const item of configs) {
        await WeeklySpecialGiftConfig.findOneAndUpdate(
          { week: item.week },
          { giftId: item.giftId },
          { session, new: true, runValidators: true }
        );
      }
      await session.commitTransaction();
      session.endSession();

      await deleteCache(CONFIG_CACHE_KEY);
      await bumpCacheVersion('daily_rewards');
      return { success: true, message: '4 weeks special gift configurations updated successfully.' };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  /**
   * Opens an unopened gift or chest from the user's inventory,
   * updates the inventory status, and credits the chest's coin value to their wallet.
   */
  async openInventoryGift(userId, inventoryId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Find the inventory item and populate the gift definition
      const inventoryItem = await UserGiftInventory.findOne({
        _id: inventoryId,
        userId,
        status: 'UNOPENED'
      }).populate('giftId').session(session);

      if (!inventoryItem) {
        throw new ApiError(404, 'Unopened chest or gift not found in your inventory.');
      }

      const gift = inventoryItem.giftId;
      if (!gift) {
        throw new ApiError(404, 'Associated gift definition not found.');
      }

      const coinsToGrant = gift.coin || 0;

      // 2. Process inventory status update (handles multiple quantity case)
      if (inventoryItem.quantity > 1) {
        inventoryItem.quantity -= 1;
        await inventoryItem.save({ session });

        // Add or increment an "OPENED" record
        const openedRecord = await UserGiftInventory.findOne({
          userId,
          giftId: gift._id,
          status: 'OPENED'
        }).session(session);

        if (openedRecord) {
          openedRecord.quantity += 1;
          await openedRecord.save({ session });
        } else {
          await UserGiftInventory.create([{
            userId,
            giftId: gift._id,
            quantity: 1,
            status: 'OPENED'
          }], { session });
        }
      } else {
        // Just change status to OPENED
        inventoryItem.status = 'OPENED';
        await inventoryItem.save({ session });
      }

      // 3. Credit user's wallet with the chest's coin value (if any)
      let wallet = null;
      if (coinsToGrant > 0) {
        wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) {
          wallet = new Wallet({ userId, coinBalance: 0 });
        }
        wallet.coinBalance += coinsToGrant;
        wallet.totalEarned = (wallet.totalEarned || 0) + coinsToGrant;
        await wallet.save({ session });

        // Create transaction history ledger
        await CoinTransaction.create([{
          userId,
          type: 'CREDIT',
          amount: coinsToGrant,
          balanceAfter: wallet.coinBalance,
          referenceType: 'BONUS',
          description: `Opened chest reward: "${gift.name}"`
        }], { session });
      }

      await session.commitTransaction();
      session.endSession();

      // 4. Invalidate related caches
      await Promise.all([
        deleteCache(`wallet:user:${userId}`),
        bumpCacheVersion(`coin_transactions:user:${userId}`),
        bumpCacheVersion('admin:wallets')
      ]);

      // 5. Emit socket update
      emitToUser(userId.toString(), 'daily_reward:chest_opened', {
        inventoryId,
        giftName: gift.name,
        coinsGranted: coinsToGrant,
        newBalance: wallet ? wallet.coinBalance : 0
      });

      return {
        success: true,
        message: `Successfully opened ${gift.name}! Credited ${coinsToGrant} Coins.`,
        coinsGranted: coinsToGrant,
        newBalance: wallet ? wallet.coinBalance : 0
      };

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Helper to increment/insert a gift in user inventory.
   */
  async _creditGiftToInventory(userId, giftId, session) {
    const existing = await UserGiftInventory.findOne({ userId, giftId, status: 'UNOPENED' }).session(session);
    if (existing) {
      existing.quantity += 1;
      await existing.save({ session });
    } else {
      await UserGiftInventory.create([{
        userId,
        giftId,
        quantity: 1,
        status: 'UNOPENED'
      }], { session });
    }
  }
}

export default new DailyRewardService();
