import mongoose from 'mongoose';
import User from '../modules/user.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import UserGiftInventory from '../modules/user-gift-inventory.model.js';
import Notification from '../modules/notification.model.js';
import LevelConfig from '../modules/level-config.model.js';
import XpConfig from '../modules/xp-config.model.js';
import XpTransaction from '../modules/xp-transaction.model.js';
import Reward from '../modules/reward.model.js';
import RewardHistory from '../modules/reward-history.model.js';
import { ONE_TIME_XP_ACTIONS } from '../constants/enum.constant.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import { emitToUser } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';

// One-time action → User model guard flag mapping
const ONE_TIME_FLAG_MAP = {
  PROFILE_COMPLETE: 'profileXpAwarded',
  FIRST_CALL: 'firstCallDone',
};

class XpService {
  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: Award XP to a user for an action
  // ═══════════════════════════════════════════════════════════════════
  async awardXp(userId, action, metadata = {}) {
    try {
      // 1. Fetch XP config for this action (cached)
      const xpConfig = await this._getXpConfigForAction(action);
      if (!xpConfig || !xpConfig.isActive || xpConfig.xp <= 0) {
        return null; // Action disabled or no XP configured
      }

      // 2. One-time action guard (atomic)
      if (ONE_TIME_XP_ACTIONS.includes(action)) {
        const flagField = ONE_TIME_FLAG_MAP[action];
        if (!flagField) return null;

        const updated = await User.findOneAndUpdate(
          { _id: userId, [flagField]: false },
          { $set: { [flagField]: true } },
          { new: true }
        );
        if (!updated) return null; // Already awarded — bail out silently
      }

      // 3. Fetch current user state
      const user = await User.findById(userId);
      if (!user) return null;

      const xpBefore = user.totalXp || 0;
      const levelBefore = user.currentLevel || 1;
      const newXp = xpBefore + xpConfig.xp;

      // 4. Determine new level
      const levelConfigs = await this._getLevelConfigs();
      const newLevel = this._calculateLevel(newXp, levelConfigs);

      // 5. Process level-up if applicable
      let levelUpData = null;
      if (newLevel > levelBefore) {
        levelUpData = await this._processLevelUp(userId, levelBefore, newLevel, levelConfigs);
      }

      // 6. Update user XP and level atomically
      await User.findByIdAndUpdate(userId, {
        $set: { totalXp: newXp, currentLevel: newLevel },
      });

      // 7. Write XP transaction ledger
      await XpTransaction.create({
        userId,
        action,
        xpAwarded: xpConfig.xp,
        xpBefore,
        xpAfter: newXp,
        levelBefore,
        levelAfter: newLevel,
        metadata,
      });

      // 8. Invalidate user caches
      await Promise.all([
        deleteCache(`auth:user:${userId}`),
        deleteCache(`user:${userId}`),
      ]);

      // 9. Emit xp:earned socket event
      const progressData = this._calculateProgress(newXp, newLevel, levelConfigs);
      emitToUser(userId.toString(), 'xp:earned', {
        action,
        xpAwarded: xpConfig.xp,
        newXp,
        currentLevel: newLevel,
        ...progressData,
      });

      return {
        xpAwarded: xpConfig.xp,
        newXp,
        levelBefore,
        newLevel,
        leveledUp: newLevel > levelBefore,
        levelUpData,
      };
    } catch (error) {
      logger.error(`[XpService] Error awarding XP for action "${action}" to user ${userId}: ${error.message}`);
      return null; // Fire-and-forget — never crash the caller
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: Get user's XP profile (level, progress, etc.)
  // ═══════════════════════════════════════════════════════════════════
  async getUserXpProfile(userId) {
    const user = await User.findById(userId).select('totalXp currentLevel badges').lean();
    if (!user) throw new ApiError(404, 'User not found');

    const levelConfigs = await this._getLevelConfigs();
    const currentXp = user.totalXp || 0;
    const currentLevel = user.currentLevel || 1;

    const currentLevelConfig = levelConfigs.find(l => l.level === currentLevel);
    const nextLevelConfig = levelConfigs.find(l => l.level === currentLevel + 1);

    const xpForCurrentLevel = currentLevelConfig?.xpRequired || 0;
    const xpForNextLevel = nextLevelConfig?.xpRequired || null;

    let xpToNextLevel = null;
    let progressPercent = 100;

    if (xpForNextLevel !== null) {
      xpToNextLevel = Math.max(0, xpForNextLevel - currentXp);
      const range = xpForNextLevel - xpForCurrentLevel;
      progressPercent = range > 0
        ? Math.floor(((currentXp - xpForCurrentLevel) / range) * 100)
        : 100;
      progressPercent = Math.max(0, Math.min(100, progressPercent));
    }

    return {
      currentLevel,
      currentXp,
      xpForCurrentLevel,
      xpForNextLevel,
      xpToNextLevel,
      progressPercent,
      title: currentLevelConfig?.title || 'Newcomer',
      badge: currentLevelConfig?.badge || null,
      nextLevelTitle: nextLevelConfig?.title || null,
      badges: user.badges || [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: Leaderboard (top users by totalXp)
  // ═══════════════════════════════════════════════════════════════════
  async getLeaderboard(limit = 20) {
    const cacheKey = `xp:leaderboard:${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const leaders = await User.find({ isDeleted: false, isBlocked: false })
      .sort({ totalXp: -1 })
      .limit(limit)
      .select('firstName lastName profileImage totalXp currentLevel badges')
      .lean();

    await setCache(cacheKey, leaders, 300); // 5 min
    return leaders;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: XP History (paginated XP transaction log)
  // ═══════════════════════════════════════════════════════════════════
  async getXpHistory(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      XpTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      XpTransaction.countDocuments({ userId }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN: Level Config CRUD
  // ═══════════════════════════════════════════════════════════════════
  async getAllLevelConfigs() {
    const configs = await LevelConfig.find()
      .sort({ level: 1 })
      .populate('rewards')
      .lean();
    return configs;
  }

  async createLevelConfig(data) {
    const config = await LevelConfig.create(data);
    await deleteCache('xp:level_configs');
    return config;
  }

  async updateLevelConfig(id, data) {
    const config = await LevelConfig.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).populate('rewards');
    if (!config) throw new ApiError(404, 'Level config not found');
    await deleteCache('xp:level_configs');
    return config;
  }

  async deleteLevelConfig(id) {
    const config = await LevelConfig.findByIdAndDelete(id);
    if (!config) throw new ApiError(404, 'Level config not found');
    await deleteCache('xp:level_configs');
    return config;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN: Level Reward CRUD
  // ═══════════════════════════════════════════════════════════════════
  async getAllRewards() {
    return await Reward.find().sort({ createdAt: -1 }).lean();
  }

  async createReward(data) {
    const reward = await Reward.create(data);
    await deleteCache('xp:level_configs'); // Rewards affect level data
    return reward;
  }

  async updateReward(id, data) {
    const reward = await Reward.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
    if (!reward) throw new ApiError(404, 'Reward not found');
    await deleteCache('xp:level_configs');
    return reward;
  }

  async deleteReward(id) {
    const reward = await Reward.findByIdAndDelete(id);
    if (!reward) throw new ApiError(404, 'Reward not found');
    // Remove from all LevelConfigs that reference this reward
    await LevelConfig.updateMany(
      { rewards: id },
      { $pull: { rewards: id } }
    );
    await deleteCache('xp:level_configs');
    return reward;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN: XP Action Config
  // ═══════════════════════════════════════════════════════════════════
  async getAllXpActions() {
    return await XpConfig.find().sort({ action: 1 }).lean();
  }

  async updateXpAction(action, data) {
    const config = await XpConfig.findOneAndUpdate(
      { action },
      data,
      { new: true, runValidators: true }
    );
    if (!config) throw new ApiError(404, `XP action "${action}" not found`);
    await deleteCache('xp:action_configs');
    await deleteCache(`xp:action:${action}`);
    return config;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN: Manual XP Grant
  // ═══════════════════════════════════════════════════════════════════
  async adminGrantXp(userId, xpAmount, reason = 'Admin manual grant') {
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, 'User not found');

    const xpBefore = user.totalXp || 0;
    const levelBefore = user.currentLevel || 1;
    const newXp = xpBefore + xpAmount;

    const levelConfigs = await this._getLevelConfigs();
    const newLevel = this._calculateLevel(newXp, levelConfigs);

    let levelUpData = null;
    if (newLevel > levelBefore) {
      levelUpData = await this._processLevelUp(userId, levelBefore, newLevel, levelConfigs);
    }

    await User.findByIdAndUpdate(userId, {
      $set: { totalXp: newXp, currentLevel: newLevel },
    });

    await XpTransaction.create({
      userId,
      action: 'DAILY_LOGIN', // Using DAILY_LOGIN as placeholder for admin grants
      xpAwarded: xpAmount,
      xpBefore,
      xpAfter: newXp,
      levelBefore,
      levelAfter: newLevel,
      metadata: { reason, adminGrant: 'true' },
    });

    await Promise.all([
      deleteCache(`auth:user:${userId}`),
      deleteCache(`user:${userId}`),
    ]);

    emitToUser(userId.toString(), 'xp:earned', {
      action: 'ADMIN_GRANT',
      xpAwarded: xpAmount,
      newXp,
      currentLevel: newLevel,
    });

    return {
      xpAwarded: xpAmount,
      newXp,
      levelBefore,
      newLevel,
      leveledUp: newLevel > levelBefore,
      levelUpData,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: Reward Inventory (claimable rewards earned via level-ups)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * List a user's reward inventory, optionally filtered by status.
   */
  async getRewardInventory(userId, status = null) {
    const filter = { userId };
    if (status) filter.status = status;

    const [rewards, unclaimedCount] = await Promise.all([
      RewardHistory.find(filter).sort({ createdAt: -1 }).lean(),
      RewardHistory.countDocuments({ userId, status: 'UNCLAIMED' }),
    ]);

    return { rewards, unclaimedCount };
  }

  /**
   * Claim a single unclaimed reward from the inventory.
   * Atomically flips status to prevent double-claiming, then applies the reward.
   */
  async claimReward(userId, inventoryId) {
    // 1. Atomic claim — only succeeds if still UNCLAIMED (race-safe)
    const item = await RewardHistory.findOneAndUpdate(
      { _id: inventoryId, userId, status: 'UNCLAIMED' },
      { $set: { status: 'CLAIMED', claimedAt: new Date() } },
      { new: true }
    );
    if (!item) {
      throw new ApiError(400, 'Reward already claimed or not found.');
    }

    // 2. Actually apply the reward
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await this._grantRewardToUser(userId, item, session);

      // Record coins granted on the inventory row for COINS rewards
      if (item.rewardType === 'COINS') {
        item.coinsGranted = item.value;
        await item.save({ session });
      }

      await session.commitTransaction();
      session.endSession();
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      // Roll back the status flip so the user can retry
      await RewardHistory.updateOne(
        { _id: inventoryId },
        { $set: { status: 'UNCLAIMED', claimedAt: null } }
      );
      logger.error(`[XpService] claimReward failed for user ${userId}, item ${inventoryId}: ${error.message}`);
      throw new ApiError(500, 'Failed to claim reward. Please try again.');
    }

    // 3. Invalidate caches
    await Promise.all([
      deleteCache(`wallet:user:${userId}`),
      deleteCache(`auth:user:${userId}`),
      deleteCache(`user:${userId}`),
    ]);

    // 4. Emit claim event
    emitToUser(userId.toString(), 'reward:claimed', {
      inventoryId: item._id,
      type: item.rewardType,
      label: item.label,
      value: item.value,
      icon: item.icon,
    });

    return {
      inventoryId: item._id,
      type: item.rewardType,
      label: item.label,
      value: item.value,
      claimedAt: item.claimedAt,
    };
  }

  /**
   * Claim all unclaimed rewards for a user.
   */
  async claimAllRewards(userId) {
    const pending = await RewardHistory.find({ userId, status: 'UNCLAIMED' }).select('_id').lean();

    const claimed = [];
    const failed = [];
    for (const { _id } of pending) {
      try {
        claimed.push(await this.claimReward(userId, _id));
      } catch (error) {
        failed.push({ inventoryId: _id, reason: error.message });
      }
    }

    return { claimedCount: claimed.length, claimed, failed };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: Process Level Up (deposit rewards into inventory as UNCLAIMED)
  // ═══════════════════════════════════════════════════════════════════
  async _processLevelUp(userId, oldLevel, newLevel, levelConfigs) {
    const session = await mongoose.startSession();
    session.startTransaction();

    const allRewards = [];

    try {
      for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
        const levelConfig = levelConfigs.find(l => l.level === lvl);
        if (!levelConfig) continue;

        // Fetch populated rewards for this level
        const fullLevelConfig = await LevelConfig.findOne({ level: lvl })
          .populate('rewards')
          .session(session)
          .lean();

        if (!fullLevelConfig || !fullLevelConfig.rewards?.length) continue;

        for (const reward of fullLevelConfig.rewards) {
          if (!reward.isActive) continue;

          // Deposit into inventory as UNCLAIMED — nothing is granted yet.
          // A full snapshot is stored so admin edits/deletes can't change
          // what the user was promised.
          await RewardHistory.create([{
            userId,
            level: lvl,
            rewardId: reward._id,
            rewardType: reward.type,
            referenceId: reward.referenceId || null,
            value: reward.value,
            label: reward.label,
            icon: reward.icon,
            coinsGranted: 0,
            description: reward.label,
            status: 'UNCLAIMED',
          }], { session });

          allRewards.push({
            type: reward.type,
            label: reward.label,
            value: reward.value,
            icon: reward.icon,
          });
        }

        // Create in-app notification for level-up
        await Notification.create([{
          recipientId: userId,
          title: '🎉 Level Up!',
          body: `Congratulations! You reached Level ${lvl} — "${levelConfig.title}"! Claim your rewards in your inventory.`,
          type: 'LEVEL_UP',
          metadata: {
            level: lvl.toString(),
            title: levelConfig.title,
          },
        }], { session });
      }

      await session.commitTransaction();
      session.endSession();

      // Emit level-up socket event — rewards are claimable, not yet granted
      const finalLevelConfig = levelConfigs.find(l => l.level === newLevel);
      emitToUser(userId.toString(), 'xp:level_up', {
        newLevel,
        levelTitle: finalLevelConfig?.title || `Level ${newLevel}`,
        badge: finalLevelConfig?.badge || null,
        rewards: allRewards,
        claimable: true,
        celebrationMessage: `🎉 You reached Level ${newLevel}! Claim your rewards.`,
      });

      return { newLevel, rewards: allRewards };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error(`[XpService] Level-up processing failed for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: Apply a reward to the user's account (called on claim)
  // ═══════════════════════════════════════════════════════════════════
  async _grantRewardToUser(userId, item, session) {
    switch (item.rewardType) {
      case 'COINS': {
        let wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) {
          wallet = new Wallet({ userId, coinBalance: 0 });
        }
        wallet.coinBalance += item.value;
        wallet.totalEarned = (wallet.totalEarned || 0) + item.value;
        await wallet.save({ session });

        await CoinTransaction.create([{
          userId,
          type: 'CREDIT',
          amount: item.value,
          balanceAfter: wallet.coinBalance,
          referenceType: 'BONUS',
          description: `Level ${item.level} reward: ${item.label}`,
        }], { session });
        break;
      }

      case 'AVATAR': {
        if (item.referenceId) {
          await User.findByIdAndUpdate(
            userId,
            { $addToSet: { unlockedAvatars: item.referenceId } },
            { session }
          );
          await deleteCache('avatars:active_list');
        }
        break;
      }

      case 'GIFT':
      case 'MYSTERY_BOX': {
        if (item.referenceId) {
          const existing = await UserGiftInventory.findOne({
            userId,
            giftId: item.referenceId,
            status: 'UNOPENED',
          }).session(session);

          if (existing) {
            existing.quantity += 1;
            await existing.save({ session });
          } else {
            await UserGiftInventory.create([{
              userId,
              giftId: item.referenceId,
              quantity: 1,
              status: 'UNOPENED',
            }], { session });
          }
        }
        break;
      }

      case 'BADGE': {
        const badgeValue = item.referenceId?.toString() || item.label;
        await User.findByIdAndUpdate(
          userId,
          { $addToSet: { badges: badgeValue } },
          { session }
        );
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: Helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get cached XP config for a specific action.
   */
  async _getXpConfigForAction(action) {
    const cacheKey = `xp:action:${action}`;
    let config = await getCache(cacheKey);
    if (config) return config;

    config = await XpConfig.findOne({ action }).lean();
    if (config) {
      await setCache(cacheKey, config, 1800); // 30 min
    }
    return config;
  }

  /**
   * Get all active level configs (cached).
   */
  async _getLevelConfigs() {
    const cacheKey = 'xp:level_configs';
    let configs = await getCache(cacheKey);
    if (configs) return configs;

    configs = await LevelConfig.find({ isActive: true })
      .sort({ level: 1 })
      .lean();
    await setCache(cacheKey, configs, 1800); // 30 min
    return configs;
  }

  /**
   * Find the highest level the user qualifies for.
   */
  _calculateLevel(totalXp, levelConfigs) {
    // Sort descending by xpRequired, find first config where xp >= xpRequired
    const sorted = [...levelConfigs].sort((a, b) => b.xpRequired - a.xpRequired);
    const matched = sorted.find(l => totalXp >= l.xpRequired);
    return matched?.level ?? 1;
  }

  /**
   * Calculate progress towards next level.
   */
  _calculateProgress(currentXp, currentLevel, levelConfigs) {
    const currentLevelConfig = levelConfigs.find(l => l.level === currentLevel);
    const nextLevelConfig = levelConfigs.find(l => l.level === currentLevel + 1);

    const xpForCurrentLevel = currentLevelConfig?.xpRequired || 0;
    const xpForNextLevel = nextLevelConfig?.xpRequired || null;

    if (xpForNextLevel === null) {
      return { progressPercent: 100, xpToNextLevel: 0 };
    }

    const range = xpForNextLevel - xpForCurrentLevel;
    const progressPercent = range > 0
      ? Math.max(0, Math.min(100, Math.floor(((currentXp - xpForCurrentLevel) / range) * 100)))
      : 100;

    return {
      progressPercent,
      xpToNextLevel: Math.max(0, xpForNextLevel - currentXp),
    };
  }
}

export default new XpService();
