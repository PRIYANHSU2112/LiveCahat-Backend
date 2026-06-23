import mongoose from 'mongoose';
import AnchorLevel from '../modules/anchor-level.model.js';
import AnchorRewardClaim from '../modules/anchor-reward-claim.model.js';
import User from '../modules/user.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import UserGiftInventory from '../modules/user-gift-inventory.model.js';
import Notification from '../modules/notification.model.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import { emitToUser } from '../utils/socket.util.js';

const LEVELS_CACHE_KEY = 'anchor:levels';
const USER_POPULATE = { path: 'userId', select: 'firstName lastName profileImage' };

class AnchorLevelService {
  // ─── Level ladder (cached) ──────────────────────────────────────
  async getActiveLevels() {
    const cached = await getCache(LEVELS_CACHE_KEY);
    if (cached) return cached;

    const levels = await AnchorLevel.find({ isActive: true }).sort({ level: 1 }).lean();
    await setCache(LEVELS_CACHE_KEY, levels, 1800); // 30 min
    return levels;
  }

  // ─── Admin: level CRUD ──────────────────────────────────────────
  async getAllLevels() {
    return await AnchorLevel.find().sort({ level: 1 }).lean();
  }

  async createLevel(data) {
    const level = await AnchorLevel.create(data);
    await deleteCache(LEVELS_CACHE_KEY);
    return level;
  }

  async updateLevel(id, data) {
    const level = await AnchorLevel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!level) throw new ApiError(404, 'Anchor level not found');
    await deleteCache(LEVELS_CACHE_KEY);
    return level;
  }

  async deleteLevel(id) {
    const level = await AnchorLevel.findByIdAndDelete(id);
    if (!level) throw new ApiError(404, 'Anchor level not found');
    await deleteCache(LEVELS_CACHE_KEY);
    return level;
  }

  // ─── Listener: status ───────────────────────────────────────────
  async getMyAnchorStatus(userId) {
    const [profile, user, levels, unclaimedCount] = await Promise.all([
      ListenerProfile.findOne({ userId }).select('anchorLevel totalEarnings').lean(),
      User.findById(userId).select('profileCompleted').lean(),
      this.getActiveLevels(),
      AnchorRewardClaim.countDocuments({ userId, status: 'UNCLAIMED' }),
    ]);
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    const anchorLevel = profile.anchorLevel || 0;
    const totalEarnings = profile.totalEarnings || 0;
    const profileCompleted = !!user?.profileCompleted;

    const currentLevelConfig = levels.find((l) => l.level === anchorLevel) || null;
    const nextLevelConfig = levels.find((l) => l.level > anchorLevel) || null;

    let nextLevel = null;
    if (nextLevelConfig) {
      let progressPercent;
      if (nextLevelConfig.requirementType === 'PROFILE_COMPLETE') {
        progressPercent = profileCompleted ? 100 : 0;
      } else {
        const req = nextLevelConfig.requiredEarnings || 0;
        progressPercent = req > 0 ? Math.min(100, Math.floor((totalEarnings / req) * 100)) : 100;
      }
      nextLevel = {
        level: nextLevelConfig.level,
        title: nextLevelConfig.title,
        requirementType: nextLevelConfig.requirementType,
        requiredEarnings: nextLevelConfig.requiredEarnings,
        progressPercent,
      };
    }

    return {
      anchorLevel,
      currentTitle: currentLevelConfig?.title || null,
      totalEarnings,
      profileCompleted,
      nextLevel,
      unclaimedCount,
      ladder: levels.map((l) => ({
        level: l.level,
        title: l.title,
        requirementType: l.requirementType,
        requiredEarnings: l.requiredEarnings,
        badge: l.badge,
      })),
    };
  }

  // ─── Engine: evaluate & deposit (fire-and-forget) ───────────────
  async evaluateAnchorLevel(userId) {
    const profile = await ListenerProfile.findOne({ userId }).select('anchorLevel totalEarnings').lean();
    if (!profile) return null; // not a listener

    const user = await User.findById(userId).select('profileCompleted').lean();
    const levels = await this.getActiveLevels();

    const oldLevel = profile.anchorLevel || 0;
    const totalEarnings = profile.totalEarnings || 0;
    const profileCompleted = !!user?.profileCompleted;

    const satisfies = (lvl) =>
      lvl.requirementType === 'PROFILE_COMPLETE'
        ? profileCompleted
        : totalEarnings >= (lvl.requiredEarnings || 0);

    // Contiguous progression above the current level
    let newLevel = oldLevel;
    for (const lvl of levels.filter((l) => l.level > oldLevel)) {
      if (satisfies(lvl)) newLevel = lvl.level;
      else break;
    }
    if (newLevel <= oldLevel) return null;

    const crossed = levels.filter((l) => l.level > oldLevel && l.level <= newLevel);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Guarded atomic bump — if another worker already advanced, abort (idempotent)
      const bumped = await ListenerProfile.findOneAndUpdate(
        { userId, anchorLevel: oldLevel },
        { $set: { anchorLevel: newLevel } },
        { new: true, session }
      );
      if (!bumped) {
        await session.abortTransaction();
        session.endSession();
        return null;
      }

      for (const lvl of crossed) {
        for (const reward of lvl.rewards || []) {
          await AnchorRewardClaim.create([{
            userId,
            level: lvl.level,
            rewardType: reward.type,
            value: reward.value,
            referenceId: reward.referenceId || null,
            label: reward.label,
            icon: reward.icon,
            coinsGranted: 0,
            status: 'UNCLAIMED',
          }], { session });
        }

        await Notification.create([{
          recipientId: userId,
          title: '🚀 Anchor Level Up!',
          body: `You reached Anchor Level ${lvl.level} — "${lvl.title}"! Claim your rewards.`,
          type: 'LEVEL_UP',
          metadata: { level: lvl.level.toString(), title: lvl.title },
        }], { session });
      }

      await session.commitTransaction();
      session.endSession();

      emitToUser(userId.toString(), 'anchor:level_up', {
        newLevel,
        previousLevel: oldLevel,
        levels: crossed.map((l) => ({ level: l.level, title: l.title })),
      });

      return { oldLevel, newLevel };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      logger.error(`[AnchorLevelService] evaluate failed for ${userId}: ${error.message}`);
      throw error;
    }
  }

  // ─── Listener: reward inventory ─────────────────────────────────
  async getRewardInventory(userId, status = null) {
    const filter = { userId };
    if (status) filter.status = status;

    const [rewards, unclaimedCount] = await Promise.all([
      AnchorRewardClaim.find(filter).sort({ createdAt: -1 }).lean(),
      AnchorRewardClaim.countDocuments({ userId, status: 'UNCLAIMED' }),
    ]);
    return { rewards, unclaimedCount };
  }

  async claimReward(userId, claimId) {
    // Atomic claim — only succeeds if still UNCLAIMED (race-safe)
    const item = await AnchorRewardClaim.findOneAndUpdate(
      { _id: claimId, userId, status: 'UNCLAIMED' },
      { $set: { status: 'CLAIMED', claimedAt: new Date() } },
      { new: true }
    );
    if (!item) throw new ApiError(400, 'Reward already claimed or not found.');

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await this._grantAnchorReward(userId, item, session);
      if (item.rewardType === 'COINS') {
        item.coinsGranted = item.value;
        await item.save({ session });
      }
      await session.commitTransaction();
      session.endSession();
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      // Roll back so the listener can retry
      await AnchorRewardClaim.updateOne({ _id: claimId }, { $set: { status: 'UNCLAIMED', claimedAt: null } });
      logger.error(`[AnchorLevelService] claim failed for ${userId}, item ${claimId}: ${error.message}`);
      throw new ApiError(500, 'Failed to claim reward. Please try again.');
    }

    await Promise.all([
      deleteCache(`wallet:user:${userId}`),
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
    ]);

    emitToUser(userId.toString(), 'anchor:reward_claimed', {
      claimId: item._id,
      type: item.rewardType,
      label: item.label,
      value: item.value,
    });

    return {
      claimId: item._id,
      type: item.rewardType,
      label: item.label,
      value: item.value,
      claimedAt: item.claimedAt,
    };
  }

  async claimAllRewards(userId) {
    const pending = await AnchorRewardClaim.find({ userId, status: 'UNCLAIMED' }).select('_id').lean();

    const claimed = [];
    const failed = [];
    for (const { _id } of pending) {
      try {
        claimed.push(await this.claimReward(userId, _id));
      } catch (error) {
        failed.push({ claimId: _id, reason: error.message });
      }
    }
    return { claimedCount: claimed.length, claimed, failed };
  }

  // ─── Apply a reward on claim ────────────────────────────────────
  async _grantAnchorReward(userId, item, session) {
    switch (item.rewardType) {
      case 'COINS': {
        const wallet = await Wallet.findOneAndUpdate(
          { userId },
          { $inc: { coinBalance: item.value, totalEarned: item.value } },
          { new: true, upsert: true, setDefaultsOnInsert: true, session }
        );
        await CoinTransaction.create([{
          userId,
          type: 'CREDIT',
          amount: item.value,
          balanceAfter: wallet.coinBalance,
          referenceType: 'BONUS',
          description: `Anchor Level ${item.level} reward: ${item.label || 'Coins'}`,
        }], { session });
        break;
      }
      case 'GIFT': {
        if (item.referenceId) {
          const existing = await UserGiftInventory.findOne({
            userId,
            giftId: item.referenceId,
            status: 'UNOPENED',
          }).session(session);
          if (existing) {
            existing.quantity += item.value || 1;
            await existing.save({ session });
          } else {
            await UserGiftInventory.create([{
              userId,
              giftId: item.referenceId,
              quantity: item.value || 1,
              status: 'UNOPENED',
            }], { session });
          }
        }
        break;
      }
      case 'ITEM':
      default:
        // Generic reward — the claim row itself is the record; nothing else to grant.
        break;
    }
  }

  // ─── Admin: track claims ────────────────────────────────────────
  async adminGetClaims(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({ sortBy: 'createdAt', sortOrder: 'desc', ...query });
    const filter = {};
    if (query.userId) filter.userId = query.userId;
    if (query.status) filter.status = query.status;

    const [docs, total] = await Promise.all([
      AnchorRewardClaim.find(filter).populate(USER_POPULATE).sort(sort).skip(skip).limit(limit).lean(),
      AnchorRewardClaim.countDocuments(filter),
    ]);
    return formatPaginatedResponse(docs, total, page, limit);
  }
}

export default new AnchorLevelService();
