import mongoose from 'mongoose';
import Avatar from '../modules/avatar.model.js';
import User from '../modules/user.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { emitToUser } from '../utils/socket.util.js';

class AvatarService {
  /**
   * Admin: Create a new avatar asset.
   */
  async createAvatar(data) {
    const avatar = await Avatar.create(data);
    await deleteCache('avatars:active_list');
    return avatar;
  }

  /**
   * Admin: Update avatar details.
   */
  async updateAvatar(id, data) {
    const avatar = await Avatar.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!avatar) throw new ApiError(404, 'Avatar not found');
    await deleteCache('avatars:active_list');
    return avatar;
  }

  /**
   * Admin: Delete an avatar.
   */
  async deleteAvatar(id) {
    const avatar = await Avatar.findByIdAndDelete(id);
    if (!avatar) throw new ApiError(404, 'Avatar not found');
    await deleteCache('avatars:active_list');
    return avatar;
  }

  /**
   * Public: List all active avatars, annotated with an isUnlocked boolean.
   */
  async getAvatars(userId) {
    // 1. Fetch user unlocked list
    const user = await User.findById(userId).select('unlockedAvatars').lean();
    console.log('DEBUG [getAvatars]: user object fetched:', JSON.stringify(user));
    const unlockedList = user?.unlockedAvatars || [];
    const unlockedSet = new Set(unlockedList.map(id => id.toString()));
    console.log('DEBUG [getAvatars]: unlockedSet size:', unlockedSet.size, 'keys:', Array.from(unlockedSet.keys()));

    // 2. Fetch active avatars (cached for performance)
    const cacheKey = 'avatars:active_list';
    let avatars = await getCache(cacheKey);
    if (!avatars) {
      avatars = await Avatar.find({ isActive: true }).sort({ category: 1, name: 1 }).lean();
      await setCache(cacheKey, avatars, 1800); // 1 hour cache
    }

    // 3. Annotate list
    return avatars.map(avatar => {
      const avatarIdStr = avatar._id ? avatar._id.toString() : '';
      console.log('DEBUG [getAvatars]: mapping avatar:', avatar.name, 'id:', avatar._id, 'avatarIdStr:', avatarIdStr, 'isUnlocked?', avatar.priceType === 'FREE' || unlockedSet.has(avatarIdStr));
      const isUnlocked = avatar.priceType === 'FREE' || unlockedSet.has(avatarIdStr);
      return {
        ...avatar,
        isUnlocked
      };
    });
  }

  /**
   * Set an unlocked (or free) avatar as the user's profile image.
   */
  async setAvatarAsProfile(userId, avatarId) {
    const avatar = await Avatar.findById(avatarId).lean();
    if (!avatar || !avatar.isActive) throw new ApiError(404, 'Avatar not found or inactive');

    const isFree = avatar.priceType === 'FREE';
    if (!isFree) {
      const user = await User.findById(userId).select('unlockedAvatars').lean();
      const hasUnlocked = user?.unlockedAvatars?.some(id => id.toString() === avatarId.toString());
      if (!hasUnlocked) throw new ApiError(403, 'You have not unlocked this avatar');
    }

    await User.findByIdAndUpdate(userId, { profileImage: avatar.image });

    await Promise.all([
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
    ]);

    return { profileImage: avatar.image, avatar };
  }

  /**
   * Executes transactional unlocking of a paid avatar, deducting wallet coins
   * and adding the reference directly to the user's unlocked list in user schema.
   */
  async unlockAvatar(userId, avatarId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Fetch avatar and check eligibility
      const avatar = await Avatar.findById(avatarId).session(session);
      if (!avatar || !avatar.isActive) {
        throw new ApiError(404, 'Avatar not found or is currently inactive');
      }

      if (avatar.priceType === 'FREE') {
        throw new ApiError(400, 'Free avatars are unlocked by default.');
      }

      // 2. Fetch User
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const unlockedAvatars = user.unlockedAvatars || [];
      const alreadyUnlocked = unlockedAvatars.some(id => id.toString() === avatarId.toString());
      if (alreadyUnlocked) {
        throw new ApiError(400, 'Avatar is already unlocked.');
      }

      // 3. Process Paid Avatar Transaction
      const price = avatar.price || 0;
      let wallet = null;

      if (price > 0) {
        wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet || wallet.coinBalance < price) {
          throw new ApiError(400, 'Insufficient coin balance in your wallet to unlock this avatar.');
        }

        // Debit coins
        wallet.coinBalance -= price;
        wallet.totalSpent = (wallet.totalSpent || 0) + price;
        await wallet.save({ session });

        // Coin Transaction log
        await CoinTransaction.create([{
          userId,
          type: 'DEBIT',
          amount: price,
          balanceAfter: wallet.coinBalance,
          referenceType: 'PURCHASE',
          description: `Unlocked avatar: "${avatar.name}"`
        }], { session });
      }

      // 4. Update User's Unlocked list
      user.unlockedAvatars.push(avatarId);
      await user.save({ session });

      await session.commitTransaction();
      session.endSession();

      // 5. Invalidate caches
      await Promise.all([
        deleteCache(`wallet:user:${userId}`),
        deleteCache(`auth:user:${userId}`), // Forces session profile reload in authenticate middleware
        bumpCacheVersion(`coin_transactions:user:${userId}`),
        bumpCacheVersion('admin:wallets')
      ]);

      // 6. Emit real-time Socket event
      emitToUser(userId.toString(), 'avatar:unlocked', {
        avatarId,
        avatarName: avatar.name,
        price,
        newBalance: wallet ? wallet.coinBalance : null
      });

      return {
        success: true,
        message: `Successfully unlocked avatar: "${avatar.name}"!`,
        avatar,
        price,
        newBalance: wallet ? wallet.coinBalance : null
      };

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
}

export default new AvatarService();
