import mongoose from 'mongoose';
import BaseService from './base.service.js';
import stickerRepository from '../repositories/sticker.repository.js';
import stickerCategoryRepository from '../repositories/sticker-category.repository.js';
import User from '../modules/user.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { emitToUser } from '../utils/socket.util.js';

const CACHE_NS = 'stickers';
const CATEGORY_POPULATE = { path: 'categoryId', select: 'name slug icon' };

class StickerService extends BaseService {
  constructor() {
    super(stickerRepository);
  }

  /**
   * Annotate a sticker with the requesting user's access status.
   *   FREE  → always unlocked
   *   PAID  → unlocked if purchased (in user.unlockedStickers)
   *   LEVEL → unlocked if user's level >= requiredLevel
   */
  _annotate(sticker, unlockedSet, userLevel) {
    let isUnlocked = false;
    if (sticker.unlockType === 'FREE') {
      isUnlocked = true;
    } else if (sticker.unlockType === 'PAID') {
      isUnlocked = unlockedSet.has(sticker._id.toString());
    } else if (sticker.unlockType === 'LEVEL') {
      isUnlocked = userLevel >= (sticker.requiredLevel || 1);
    }

    return {
      ...sticker,
      isUnlocked,
      // For LEVEL stickers, surface how many levels remain when still locked
      levelsToUnlock:
        sticker.unlockType === 'LEVEL' && !isUnlocked
          ? (sticker.requiredLevel || 1) - userLevel
          : 0,
    };
  }

  async createSticker(data) {
    // Ensure the referenced category exists
    const category = await stickerCategoryRepository.findById(data.categoryId, '_id');
    if (!category) throw new ApiError(404, 'Sticker category not found');

    const sticker = await this.repository.create(data);
    await bumpCacheVersion(CACHE_NS);
    return sticker;
  }

  async getAdminStats() {
    const [total, active, inactive, freeCount, paidCount, levelCount] = await Promise.all([
      this.repository.countDocuments(),
      this.repository.countDocuments({ isActive: true }),
      this.repository.countDocuments({ isActive: false }),
      this.repository.countDocuments({ unlockType: 'FREE' }),
      this.repository.countDocuments({ unlockType: 'PAID' }),
      this.repository.countDocuments({ unlockType: 'LEVEL' }),
    ]);
    return { total, active, inactive, freeCount, paidCount, levelCount };
  }

  /**
   * Paginated + filterable sticker listing (filter by category, unlockType,
   * search by name/tags, isActive).
   * User side forces isActive=true, is cached (raw page, version-keyed), and
   * each sticker is annotated per-user with its unlock status.
   */
  async getStickers(query = {}, user = null) {
    const forAdmin = user && user.type === 'ADMIN';

    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'sortOrder',
      sortOrder: 'asc',
      ...query,
    });

    const filter = {};
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.unlockType) filter.unlockType = query.unlockType;
    if (query.search) {
      const term = query.search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { tags: { $regex: term, $options: 'i' } },
      ];
    }

    // ── Admin: live data, full filter control, no cache, no annotation ──
    if (forAdmin) {
      if (query.isActive !== undefined) filter.isActive = query.isActive;

      const [docs, total] = await Promise.all([
        this.repository.findMany(filter, '', CATEGORY_POPULATE, sort, limit, skip),
        this.repository.countDocuments(filter),
      ]);
      return formatPaginatedResponse(docs, total, page, limit);
    }

    // ── User: active only. Cache the RAW page (shared, version-keyed),
    //    then annotate per-user so caching stays user-independent. ──
    filter.isActive = true;

    const version = await getCacheVersion(CACHE_NS);
    const cacheKey = `${CACHE_NS}:list:v${version}:${JSON.stringify({
      page,
      limit,
      sort,
      categoryId: query.categoryId || '',
      unlockType: query.unlockType || '',
      search: query.search || '',
    })}`;

    let rawPage = await getCache(cacheKey);
    if (!rawPage) {
      const [docs, total] = await Promise.all([
        this.repository.findMany(filter, '', CATEGORY_POPULATE, sort, limit, skip),
        this.repository.countDocuments(filter),
      ]);
      rawPage = formatPaginatedResponse(docs, total, page, limit);
      await setCache(cacheKey, rawPage, 3600); // 1 hour
    }

    // Per-user annotation (cheap, in-memory)
    const { unlockedSet, userLevel } = await this._getUserUnlockContext(user?._id);
    return {
      ...rawPage,
      docs: rawPage.docs.map((s) => this._annotate(s, unlockedSet, userLevel)),
    };
  }

  async getStickerById(id, user = null) {
    const cacheKey = `sticker:${id}`;
    let sticker = await getCache(cacheKey);

    if (!sticker) {
      sticker = await this.repository.findById(id, '', CATEGORY_POPULATE);
      if (!sticker) throw new ApiError(404, 'Sticker not found');
      await setCache(cacheKey, sticker, 3600);
    }

    // Annotate for non-admin viewers
    if (user && user.type !== 'ADMIN') {
      const { unlockedSet, userLevel } = await this._getUserUnlockContext(user._id);
      return this._annotate(sticker, unlockedSet, userLevel);
    }
    return sticker;
  }

  /**
   * Load the user's unlocked sticker set and current level for annotation.
   */
  async _getUserUnlockContext(userId) {
    if (!userId) return { unlockedSet: new Set(), userLevel: 1 };

    const user = await User.findById(userId).select('unlockedStickers currentLevel').lean();
    const unlockedSet = new Set((user?.unlockedStickers || []).map((id) => id.toString()));
    const userLevel = user?.currentLevel || 1;
    return { unlockedSet, userLevel };
  }

  /**
   * Purchase a PAID sticker with wallet coins (transactional).
   * FREE stickers need no unlock; LEVEL stickers unlock automatically by level.
   */
  async unlockSticker(userId, stickerId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const sticker = await this.repository.model.findById(stickerId).session(session);
      if (!sticker || !sticker.isActive) {
        throw new ApiError(404, 'Sticker not found or is currently inactive');
      }

      if (sticker.unlockType === 'FREE') {
        throw new ApiError(400, 'This sticker is free — no purchase needed.');
      }
      if (sticker.unlockType === 'LEVEL') {
        throw new ApiError(400, 'This sticker unlocks automatically when you reach the required level.');
      }

      const user = await User.findById(userId).session(session);
      if (!user) throw new ApiError(404, 'User not found');

      const alreadyUnlocked = (user.unlockedStickers || []).some(
        (id) => id.toString() === stickerId.toString()
      );
      if (alreadyUnlocked) {
        throw new ApiError(400, 'Sticker is already unlocked.');
      }

      const price = sticker.price || 0;
      let wallet = null;

      if (price > 0) {
        wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet || wallet.coinBalance < price) {
          throw new ApiError(400, 'Insufficient coin balance to unlock this sticker.');
        }

        wallet.coinBalance -= price;
        wallet.totalSpent = (wallet.totalSpent || 0) + price;
        await wallet.save({ session });

        await CoinTransaction.create([{
          userId,
          type: 'DEBIT',
          amount: price,
          balanceAfter: wallet.coinBalance,
          referenceType: 'PURCHASE',
          description: `Unlocked sticker: "${sticker.name}"`,
        }], { session });
      }

      user.unlockedStickers.push(stickerId);
      await user.save({ session });

      await session.commitTransaction();
      session.endSession();

      await Promise.all([
        deleteCache(`wallet:user:${userId}`),
        deleteCache(`auth:user:${userId}`),
        deleteCache(`user:${userId}`),
      ]);

      emitToUser(userId.toString(), 'sticker:unlocked', {
        stickerId,
        stickerName: sticker.name,
        price,
        newBalance: wallet ? wallet.coinBalance : null,
      });

      return {
        message: `Successfully unlocked sticker: "${sticker.name}"!`,
        stickerId,
        price,
        newBalance: wallet ? wallet.coinBalance : null,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  async updateSticker(id, data) {
    // If re-categorizing, validate the new category exists
    if (data.categoryId) {
      const category = await stickerCategoryRepository.findById(data.categoryId, '_id');
      if (!category) throw new ApiError(404, 'Sticker category not found');
    }

    const updated = await this.repository.updateById(id, data);
    if (!updated) throw new ApiError(404, 'Sticker not found');

    await Promise.all([
      deleteCache(`sticker:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return updated;
  }

  async toggleStickerStatus(id) {
    const updated = await this.repository.updateById(
      id,
      [{ $set: { isActive: { $not: '$isActive' } } }],
      { new: true }
    );
    if (!updated) throw new ApiError(404, 'Sticker not found');

    await Promise.all([
      deleteCache(`sticker:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return updated;
  }

  async deleteSticker(id) {
    const deleted = await this.repository.deleteById(id);
    if (!deleted) throw new ApiError(404, 'Sticker not found');

    await Promise.all([
      deleteCache(`sticker:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return deleted;
  }
}

export default new StickerService();
