import User from '../modules/user.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import ReferralConfig from '../modules/referral-config.model.js';
import coinPackService from './coin-pack.service.js';
import ApiError from '../utils/ApiError.js';
import { deleteCache } from '../utils/redis.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

const NOT_DELETED = { isDeleted: false };

class ReferralService {
  /**
   * Get the singleton referral config, seeding defaults if none exists.
   */
  async getReferralConfig() {
    let config = await ReferralConfig.findOne();
    if (!config) {
      config = await ReferralConfig.create({});
    }
    return config;
  }

  /**
   * Admin: update the singleton referral config.
   */
  async updateReferralConfig(data) {
    const config = await ReferralConfig.findOneAndUpdate({}, { $set: data }, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
    return config;
  }

  /**
   * Admin: referral program KPI aggregates.
   */
  async getAdminStats() {
    const [
      totalReferrers,
      totalReferred,
      pendingReferrals,
      rewardedReferrals,
      coinsAgg,
    ] = await Promise.all([
      User.countDocuments({ ...NOT_DELETED, referralCount: { $gt: 0 } }),
      User.countDocuments({ ...NOT_DELETED, referredBy: { $ne: null } }),
      User.countDocuments({
        ...NOT_DELETED,
        referredBy: { $ne: null },
        referralRewardAwarded: false,
      }),
      User.countDocuments({ ...NOT_DELETED, referralRewardAwarded: true }),
      User.aggregate([
        { $match: { ...NOT_DELETED, referralEarnings: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$referralEarnings' } } },
      ]),
    ]);

    return {
      totalReferrers,
      totalReferred,
      pendingReferrals,
      rewardedReferrals,
      totalCoinsPaid: coinsAgg[0]?.total ?? 0,
    };
  }

  /**
   * Admin: paginated referral relationships (referred customers + referrer).
   */
  async adminGetReferrals(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: query.sortOrder === 'asc' ? 'asc' : 'desc',
      page: query.page,
      limit: query.limit,
    });

    const match = { ...NOT_DELETED, referredBy: { $ne: null } };
    if (query.status === 'pending') match.referralRewardAwarded = false;
    if (query.status === 'rewarded') match.referralRewardAwarded = true;

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'referredBy',
          foreignField: '_id',
          as: 'referrer',
        },
      },
      { $unwind: { path: '$referrer', preserveNullAndEmptyArrays: false } },
      { $match: { 'referrer.isDeleted': { $ne: true } } },
    ];

    if (query.q) {
      const term = String(query.q).trim();
      if (term) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        pipeline.push({
          $match: {
            $or: [
              { firstName: regex },
              { lastName: regex },
              { inviteCode: regex },
              { 'referrer.firstName': regex },
              { 'referrer.lastName': regex },
              { 'referrer.inviteCode': regex },
            ],
          },
        });
      }
    }

    const [result] = await User.aggregate([
      ...pipeline,
      { $sort: sort },
      {
        $facet: {
          docs: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                referralRewardAwarded: 1,
                createdAt: 1,
                referred: {
                  _id: '$_id',
                  firstName: '$firstName',
                  lastName: '$lastName',
                  inviteCode: '$inviteCode',
                  referralRewardAwarded: '$referralRewardAwarded',
                  createdAt: '$createdAt',
                },
                referrer: {
                  _id: '$referrer._id',
                  firstName: '$referrer.firstName',
                  lastName: '$referrer.lastName',
                  inviteCode: '$referrer.inviteCode',
                },
                status: {
                  $cond: [{ $eq: ['$referralRewardAwarded', true] }, 'REWARDED', 'PENDING'],
                },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    const docs = result?.docs ?? [];
    const total = result?.total?.[0]?.count ?? 0;
    return formatPaginatedResponse(docs, total, page, limit);
  }

  /**
   * User-facing referral details for the "Refer & Earn" screen.
   */
  async getReferralDetails(userId) {
    let user = await User.findById(userId).select(
      'inviteCode referralCount referralEarnings currentLevel'
    );
    if (!user) throw new ApiError(404, 'User not found');

    // Backfill an invite code for legacy users that predate this feature
    if (!user.inviteCode) {
      await user.save(); // pre-save hook generates the code
    }

    const [config, packs] = await Promise.all([
      this.getReferralConfig(),
      coinPackService.getAllCoinPacks({}, false), // cached active list
    ]);

    // Commission table — what both users earn per pack the friend buys first
    const commissionTable = (packs || [])
      .map((p) => ({
        _id: p._id,
        name: p.name,
        price: p.price,
        referralBonusCoins: p.referralBonusCoins || 0,
      }))
      .sort((a, b) => a.price - b.price);

    return {
      inviteCode: user.inviteCode,
      inviteLink: `${config.inviteLinkPrefix}${user.inviteCode}`,
      referralCount: user.referralCount || 0,
      referralEarnings: user.referralEarnings || 0,
      currentLevel: user.currentLevel || 1,
      commissionTable,
    };
  }

  /**
   * Apply a referral code AFTER signup. Links the accounts only — the bonus is
   * paid later, when the referred friend makes their first coin purchase.
   * Referral codes are customer-only.
   */
  async applyReferralCode(userId, inviteCode) {
    const code = (inviteCode || '').trim().toUpperCase();

    const user = await User.findById(userId).select('referredBy referralRewardAwarded inviteCode type');
    if (!user) throw new ApiError(404, 'User not found');

    if (user.type !== 'CUSTOMER') {
      throw new ApiError(400, 'Referral codes can only be used by customer accounts.');
    }
    if (user.referredBy || user.referralRewardAwarded) {
      throw new ApiError(400, 'You have already used a referral code.');
    }
    if (user.inviteCode && user.inviteCode === code) {
      throw new ApiError(400, 'You cannot use your own referral code.');
    }

    const referrer = await User.findOne({ inviteCode: code, isDeleted: false }).select('_id');
    if (!referrer) throw new ApiError(400, 'Invalid referral code.');
    if (referrer._id.toString() === userId.toString()) {
      throw new ApiError(400, 'You cannot use your own referral code.');
    }

    // Link only — guarded so it can't be overwritten if already referred
    const updated = await User.updateOne(
      { _id: userId, referredBy: null },
      { $set: { referredBy: referrer._id } }
    );
    if (updated.matchedCount === 0) {
      throw new ApiError(400, 'You have already used a referral code.');
    }

    await deleteCache(`user:${userId}`);
    return { linked: true, message: 'Referral applied. Your bonus unlocks on your first coin purchase.' };
  }

  /**
   * Pay the referral bonus when a referred friend makes their FIRST coin
   * purchase. Both the referrer and the referred friend get the purchased
   * pack's `referralBonusCoins`. MUST run inside an active transaction.
   * Caller (wallet webhook) passes the buyer doc and the purchased coin pack.
   * Returns { referrerId, bonus } (or null when nothing was paid).
   */
  async processFirstPurchaseReward(session, buyer, coinPack) {
    if (!buyer || !buyer.referredBy || buyer.referralRewardAwarded || buyer.type !== 'CUSTOMER') {
      return null;
    }

    const bonus = coinPack?.referralBonusCoins || 0;
    if (bonus <= 0) return null; // pack has no commission — don't consume the referral

    const referrerId = buyer.referredBy;

    // Credit both users (atomic $inc upserts)
    await this._creditWallet(session, buyer._id, bonus, `Referral bonus — first purchase (${coinPack.name})`);
    await this._creditWallet(session, referrerId, bonus, `Referral reward — your friend's first purchase (${coinPack.name})`);

    // Mark the referred friend as rewarded (idempotency) + bump referrer stats
    await User.updateOne(
      { _id: buyer._id },
      { $set: { referralRewardAwarded: true } },
      { session }
    );
    await User.updateOne(
      { _id: referrerId },
      { $inc: { referralCount: 1, referralEarnings: bonus } },
      { session }
    );

    return { referrerId, bonus };
  }

  /**
   * Atomically credit a wallet (create if missing) and log a BONUS coin transaction.
   */
  async _creditWallet(session, userId, coins, description) {
    if (coins <= 0) return;

    const wallet = await Wallet.findOneAndUpdate(
      { userId },
      { $inc: { coinBalance: coins, totalEarned: coins } },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );

    await CoinTransaction.create([{
      userId,
      type: 'CREDIT',
      amount: coins,
      balanceAfter: wallet.coinBalance,
      referenceType: 'BONUS',
      description,
    }], { session });
  }

  async _invalidateUserCaches(userIds) {
    const keys = [];
    for (const id of userIds) {
      keys.push(deleteCache(`auth:user:${id}`));
      keys.push(deleteCache(`user:${id}`));
      keys.push(deleteCache(`wallet:user:${id}`));
    }
    await Promise.all(keys);
  }
}

export default new ReferralService();
