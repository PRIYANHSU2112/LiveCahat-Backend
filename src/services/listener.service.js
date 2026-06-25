import mongoose from 'mongoose';
import BaseService from './base.service.js';
import listenerRepository from '../repositories/listener.repository.js';
import userRepository from '../repositories/user.repository.js';
import walletRepository from '../repositories/wallet.repository.js';
import communicationSessionRepository from '../repositories/communication-session.repository.js';
import giftTransactionRepository from '../repositories/gift-transaction.repository.js';
import ApiError from '../utils/ApiError.js';
import { deleteFromS3 } from '../utils/aws.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { getPeriodRange, getChartGrouping, buildSeries, DASHBOARD_TZ } from '../utils/date.util.js';
import logger from '../utils/logger.util.js';
import anchorLevelService from './anchor-level.service.js';
import Language from '../modules/language.model.js';
import countryRepository from '../repositories/country.repository.js';

const round = (n) => Math.round(n || 0);

// Whitelisted sort modes for the user home feed → Mongo sort spec.
// `featured` (default) surfaces promoted listeners, then the most-followed/top-rated.
const HOME_SORTS = {
  featured: { isFeatured: -1, followersCount: -1, avgRating: -1, _id: -1 },
  popular: { followersCount: -1, totalSessions: -1, avgRating: -1, _id: -1 },
  rating: { avgRating: -1, totalRatings: -1, _id: -1 },
  newest: { createdAt: -1, _id: -1 },
};

class ListenerService extends BaseService {
  constructor() {
    super(listenerRepository);
  }

  async getProfile(userId) {
    const cacheKey = `listener:${userId}`;
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) return cachedProfile;

    const profile = await this.repository.findByUserId(userId);
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    await setCache(cacheKey, profile, 300); // 5 mins cache
    return profile;
  }

  async createOrUpdateProfile(userId, data) {
    let profile = await this.repository.findOne({ userId });
    let userCacheDelete;
    if (profile) {
      profile = await this.repository.updateById(profile._id, data);
    } else {
      // Mirror the user's country onto the listener profile so listeners can be
      // filtered by country without an extra join on the home/search feeds.
      const user = await userRepository.findById(userId, 'country');
      profile = await this.repository.create({ ...data, userId, country: user?.country || null });
      // Update user type to LISTENER if it was CUSTOMER
      await userRepository.updateById(userId, { type: 'LISTENER' });
      userCacheDelete = deleteCache(`user:${userId}`); // invalidate user cache too
    }

    const tasks = [
      deleteCache(`listener:${userId}`),
      bumpCacheVersion('listeners')
    ];
    if (userCacheDelete) tasks.push(userCacheDelete);

    await Promise.all(tasks);

    if (data.availability) {
      const { default: presenceService } = await import('./presence.service.js');
      if (data.availability === 'ONLINE') {
        await presenceService.setAvailable(userId.toString());
      } else if (data.availability === 'OFFLINE') {
        await presenceService.setOffline(userId.toString());
      }
    }

    // Mark the listener's profile complete once the key fields are filled,
    // then (re-)evaluate their anchor level (fire-and-forget).
    const isComplete = !!(
      profile.bio &&
      profile.categories?.length &&
      profile.languages?.length &&
      profile.profilePhotos?.length
    );
    if (isComplete) {
      const u = await userRepository.findById(userId, 'profileCompleted');
      if (u && !u.profileCompleted) {
        await userRepository.updateById(userId, { profileCompleted: true });
        await deleteCache(`user:${userId}`);
      }
    }
    anchorLevelService.evaluateAnchorLevel(userId).catch((err) =>
      logger.error(`[Listener Service] anchor eval failed for ${userId}: ${err.message}`)
    );

    return profile;
  }

  async toggleAvailability(userId) {
    const profile = await this.repository.findOne({ userId });
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    // Flip ONLINE ⇄ OFFLINE (any non-ONLINE state, e.g. BUSY, goes ONLINE)
    const newStatus = profile.availability === 'ONLINE' ? 'OFFLINE' : 'ONLINE';

    // Reuse the standard update path — it syncs presence service + caches
    return await this.createOrUpdateProfile(userId, { availability: newStatus });
  }

  async submitKyc(userId, kycData) {
    const profile = await this.repository.findOne({ userId }, '', '', false);
    if (!profile) throw new ApiError(404, 'Please create a listener profile first');

    const s3Tasks = [];
    if (profile.documentFront && kycData.documentFront) s3Tasks.push(deleteFromS3(profile.documentFront));
    if (profile.documentBack && kycData.documentBack) s3Tasks.push(deleteFromS3(profile.documentBack));
    if (profile.selfieImage && kycData.selfieImage) s3Tasks.push(deleteFromS3(profile.selfieImage));

    if (s3Tasks.length > 0) {
      await Promise.all(s3Tasks);
    }

    profile.documentFront = kycData.documentFront || profile.documentFront;
    profile.documentBack = kycData.documentBack || profile.documentBack;
    profile.selfieImage = kycData.selfieImage || profile.selfieImage;
    profile.kycStatus = 'UNDER_REVIEW';

    await profile.save();

    await Promise.all([
      deleteCache(`listener:${userId}`),
      bumpCacheVersion('listeners')
    ]);

    return profile;
  }

  async deleteProfile(userId) {
    const profile = await this.repository.findOne({ userId });
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    const tasks = [
      this.repository.deleteById(profile._id),
      deleteCache(`listener:${userId}`),
      bumpCacheVersion('listeners')
    ];

    if (profile.documentFront) tasks.push(deleteFromS3(profile.documentFront));
    if (profile.documentBack) tasks.push(deleteFromS3(profile.documentBack));
    if (profile.selfieImage) tasks.push(deleteFromS3(profile.selfieImage));

    await Promise.all(tasks);

    return true;
  }

  /**
   * USER HOME FEED — active listeners a customer can browse, with search + filters.
   *
   * "Active" = KYC APPROVED listener whose user account is neither deleted nor
   * blocked/disabled by an admin. Results are version-cached in Redis (60s); the
   * `listeners` cache version is bumped whenever a profile or presence changes,
   * so the feed self-invalidates without stale availability.
   *
   * @param {Object} queryParams
   * @param {String} [queryParams.q]        Name search (first/last/full name)
   * @param {String} [queryParams.language] Language ObjectId, name, or code
   * @param {String} [queryParams.country]  User countryCode (e.g. "IN")
   * @param {String} [queryParams.status]   ONLINE | OFFLINE | BUSY
   * @param {Number} [queryParams.minRating] Minimum average rating (0–5)
   * @param {String} [queryParams.sort]     featured | popular | rating | newest
   */
  async getHomeListeners(queryParams = {}) {
    const { page, limit, skip } = getPaginationOptions(queryParams);
    const sort = HOME_SORTS[queryParams.sort] || HOME_SORTS.featured;

    // ── Version-scoped cache key (auto-invalidates when `listeners` version bumps) ──
    const version = await getCacheVersion('listeners');
    const cacheKey = `listeners:home:v${version}:${JSON.stringify({
      q: queryParams.q || '',
      language: queryParams.language || '',
      country: queryParams.country || '',
      status: queryParams.status || '',
      minRating: queryParams.minRating ?? '',
      sort: queryParams.sort || 'featured',
      page,
      limit,
    })}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // ── Resolve language filter (accept ObjectId, name, or code) ──
    let languageId = null;
    if (queryParams.language) {
      if (mongoose.Types.ObjectId.isValid(queryParams.language)) {
        languageId = new mongoose.Types.ObjectId(queryParams.language);
      } else {
        const lang = await Language.findOne({
          $or: [
            { name: { $regex: `^${queryParams.language}$`, $options: 'i' } },
            { code: queryParams.language.toUpperCase() },
          ],
        }).select('_id').lean();
        // Unknown language → guaranteed-empty match instead of ignoring the filter.
        languageId = lang ? lang._id : new mongoose.Types.ObjectId();
      }
    }

    // ── Resolve country filter (accept ObjectId, ISO code, dial code, or name) ──
    let countryId = null;
    if (queryParams.country) {
      const c = queryParams.country.trim();
      if (mongoose.Types.ObjectId.isValid(c)) {
        countryId = new mongoose.Types.ObjectId(c);
      } else {
        const country =
          (await countryRepository.findByCode(c)) ||
          (await countryRepository.findByDialCode(c)) ||
          (await countryRepository.findOne({ name: { $regex: `^${c}$`, $options: 'i' } }));
        // Unknown country → guaranteed-empty match instead of ignoring the filter.
        countryId = country ? country._id : new mongoose.Types.ObjectId();
      }
    }

    // ── Listener-profile match (indexed fields first) ──
    const profileMatch = { kycStatus: 'APPROVED' };
    if (queryParams.status) profileMatch.availability = queryParams.status;
    if (languageId) profileMatch.languages = languageId;
    if (countryId) profileMatch.country = countryId;
    if (queryParams.minRating !== undefined && queryParams.minRating !== '') {
      profileMatch.avgRating = { $gte: Number(queryParams.minRating) };
    }

    // ── Joined-user match (active = not deleted, not blocked by admin) ──
    const userMatch = { 'user.isDeleted': false, 'user.isBlocked': false };
    if (queryParams.q) {
      const regex = { $regex: queryParams.q.trim(), $options: 'i' };
      userMatch.$or = [
        { 'user.firstName': regex },
        { 'user.lastName': regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: [{ $ifNull: ['$user.firstName', ''] }, ' ', { $ifNull: ['$user.lastName', ''] }] },
              regex: queryParams.q.trim(),
              options: 'i',
            },
          },
        },
      ];
    }

    const { total, data } = await this.repository.getHomeListeners(profileMatch, userMatch, sort, skip, limit);

    const response = formatPaginatedResponse(data, total, page, limit);
    await setCache(cacheKey, response, 60); // 60s — kept fresh by version bumps
    return response;
  }

  async getAllListeners(queryParams) {
    const { page, limit, skip, sort } = getPaginationOptions(queryParams);

    const matchQuery = {};
    if (queryParams.kycStatus) matchQuery.kycStatus = queryParams.kycStatus;
    if (queryParams.availability) matchQuery.availability = queryParams.availability;
    if (queryParams.createdByAgentId) matchQuery.createdByAgentId = queryParams.createdByAgentId;
    if (queryParams.profileStatus) matchQuery.profileStatus = queryParams.profileStatus;

    const userMatch = {};
    if (queryParams.isBlocked !== undefined) {
      userMatch['user.isBlocked'] = queryParams.isBlocked === 'true';
    }

    const { total, data } = await this.repository.getPaginatedListeners(matchQuery, sort, skip, limit, userMatch);

    const { default: presenceService } = await import('./presence.service.js');
    const ListenerProfile = (await import('../modules/listener-profile.model.js')).default;

    const updatedData = await Promise.all(
      data.map(async (doc) => {
        const userIdStr = doc.userId.toString();
        const redisStatus = await presenceService.getStatus(userIdStr);

        let status = doc.availability;
        if (redisStatus === 'OFFLINE' && status !== 'OFFLINE') {
          status = 'OFFLINE';
          await ListenerProfile.updateOne({ userId: doc.userId }, { availability: 'OFFLINE' });
        } else if (redisStatus !== 'OFFLINE' && status !== redisStatus) {
          status = redisStatus;
          await ListenerProfile.updateOne({ userId: doc.userId }, { availability: redisStatus });
        }

        return {
          ...doc,
          availability: status
        };
      })
    );

    const response = formatPaginatedResponse(updatedData, total, page, limit);
    return response;
  }

  // ─── Agent panel ─────────────────────────────────────────────────

  /**
   * Overlay live Redis presence onto agent rows (read-only — no DB write-back).
   * Sets `online` (bool) and refreshes `availability` for display.
   */
  async _overlayPresence(docs) {
    if (!docs.length) return docs;
    const { default: presenceService } = await import('./presence.service.js');
    return Promise.all(
      docs.map(async (doc) => {
        const status = await presenceService.getStatus(doc.userId?._id?.toString() || doc.userId);
        return { ...doc, availability: status, online: status !== 'OFFLINE' };
      })
    );
  }

  /**
   * AGENT PANEL — paginated listeners owned by the agent, with search + filters.
   * Heavy aggregation is version-cached (30s); live presence is overlaid on every
   * return so the Online column stays fresh without re-querying Mongo.
   *
   * @param {String} agentId  req.user._id of the AGENT
   * @param {Object} queryParams  search, dateFrom/dateTo, country, kycStatus,
   *   accountStatus, level, liveStatus, profileStatus, minRevenue/maxRevenue, page, limit, sort
   */
  async getAgentListeners(agentId, queryParams = {}) {
    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    const agentObjectId = new mongoose.Types.ObjectId(agentId);

    // ── Version-scoped cache key (auto-invalidates on `listeners` version bumps) ──
    const version = await getCacheVersion('listeners');
    const cacheKey = `agent_listeners:v${version}:${agentId}:${JSON.stringify({
      ...queryParams,
      page,
      limit,
    })}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return { ...cached, docs: await this._overlayPresence(cached.docs) };
    }

    // ── Resolve country filter (ObjectId / ISO code / name) ──
    let countryId;
    if (queryParams.country && queryParams.country !== 'All') {
      const c = queryParams.country.trim();
      if (mongoose.Types.ObjectId.isValid(c)) {
        countryId = new mongoose.Types.ObjectId(c);
      } else {
        const country =
          (await countryRepository.findByCode(c)) ||
          (await countryRepository.findOne({ name: { $regex: `^${c}$`, $options: 'i' } }));
        countryId = country ? country._id : new mongoose.Types.ObjectId(); // unknown → empty
      }
    }

    // ── Profile-side match (indexed; createdByAgentId scopes to this agent) ──
    const matchQuery = { createdByAgentId: agentObjectId };
    if (queryParams.kycStatus) matchQuery.kycStatus = queryParams.kycStatus;
    if (queryParams.liveStatus) matchQuery.availability = queryParams.liveStatus;
    if (queryParams.profileStatus) matchQuery.profileStatus = queryParams.profileStatus;
    if (countryId) matchQuery.country = countryId;

    if (queryParams.dateFrom || queryParams.dateTo) {
      matchQuery.createdAt = {};
      if (queryParams.dateFrom) matchQuery.createdAt.$gte = new Date(queryParams.dateFrom);
      if (queryParams.dateTo) matchQuery.createdAt.$lte = new Date(queryParams.dateTo);
    }

    // Revenue range filters the denormalized earnings field.
    if (queryParams.minRevenue !== undefined || queryParams.maxRevenue !== undefined) {
      matchQuery.totalEarnings = {};
      if (queryParams.minRevenue !== undefined) matchQuery.totalEarnings.$gte = Number(queryParams.minRevenue);
      if (queryParams.maxRevenue !== undefined) matchQuery.totalEarnings.$lte = Number(queryParams.maxRevenue);
    }

    // accountStatus: active = APPROVED & !blocked, blocked = user blocked, pending = KYC PENDING
    if (queryParams.accountStatus === 'pending') matchQuery.kycStatus = 'PENDING';
    else if (queryParams.accountStatus === 'active') matchQuery.kycStatus = 'APPROVED';

    // ── User-side match (after $unwind 'userId') ──
    const userMatch = { 'userId.isDeleted': false };
    if (queryParams.accountStatus === 'active') userMatch['userId.isBlocked'] = false;
    else if (queryParams.accountStatus === 'blocked') userMatch['userId.isBlocked'] = true;
    if (queryParams.level && queryParams.level !== 'All') {
      userMatch['userId.currentLevel'] = Number(queryParams.level);
    }
    if (queryParams.search) {
      const regex = { $regex: queryParams.search.trim(), $options: 'i' };
      userMatch.$or = [
        { 'userId.firstName': regex },
        { 'userId.lastName': regex },
        { 'userId.username': regex },
        { 'userId.email': regex },
        { 'userId.mobileNumber': regex },
      ];
    }

    const { total, data } = await this.repository.getAgentListenersPaginated(
      matchQuery,
      userMatch,
      sort,
      skip,
      limit
    );

    const response = formatPaginatedResponse(data, total, page, limit);
    await setCache(cacheKey, response, 30); // 30s; presence overlaid fresh on read
    return { ...response, docs: await this._overlayPresence(response.docs) };
  }

  /**
   * AGENT PANEL — KPI stat cards (Total / Active / Online Now / Pending Verification).
   */
  async getAgentStats(agentId) {
    const version = await getCacheVersion('listeners');
    const cacheKey = `agent_stats:v${version}:${agentId}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const stats = await this.repository.getAgentStats(new mongoose.Types.ObjectId(agentId));
    await setCache(cacheKey, stats, 30);
    return stats;
  }

  async approveOrRejectListener(listenerId, data) {
    const { kycStatus, rejectionReason } = data;

    const profile = await this.repository.findById(listenerId, '', '', false);
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    profile.kycStatus = kycStatus;
    profile.rejectionReason = kycStatus === 'REJECTED' ? rejectionReason : undefined;

    await profile.save();

    await Promise.all([
      deleteCache(`listener:${profile.userId}`),
      bumpCacheVersion('listeners')
    ]);

    // In a real app, send push notification/email to listener here
    return profile;
  }

  // ─── Dashboard ───────────────────────────────────────────────────

  /**
   * API 1 — quick card: today's earnings (sessions + gifts) and active minutes.
   */
  async getDashboard(userId) {
    const cacheKey = `listener:dashboard:${userId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { start, end } = getPeriodRange('today');
    const [session, gift] = await Promise.all([
      communicationSessionRepository.getListenerStats(userId, start, end),
      giftTransactionRepository.getListenerGiftStats(userId, start, end),
    ]);

    const data = {
      todayEarnings: round(session.earnedCoins + gift.giftCoins),
      activeMinutes: round(session.totalSeconds / 60),
    };

    await setCache(cacheKey, data, 60);
    return data;
  }

  /**
   * API 2 — overview: period-filtered stat cards + earnings growth chart.
   * `totalCoins` is the current wallet balance (not period-scoped).
   */
  async getDashboardOverview(userId, period = 'today') {
    const cacheKey = `listener:overview:${userId}:${period}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { start, end } = getPeriodRange(period);
    const { format } = getChartGrouping(period);

    const [session, gift, wallet, sessionBuckets, giftBuckets] = await Promise.all([
      communicationSessionRepository.getListenerStats(userId, start, end),
      giftTransactionRepository.getListenerGiftStats(userId, start, end),
      walletRepository.findByUserId(userId),
      communicationSessionRepository.getEarningsByBucket(userId, start, end, format, DASHBOARD_TZ),
      giftTransactionRepository.getGiftEarningsByBucket(userId, start, end, format, DASHBOARD_TZ),
    ]);

    // Merge session + gift earnings per bucket label, then build a gap-filled series.
    const merged = new Map();
    for (const b of [...sessionBuckets, ...giftBuckets]) {
      merged.set(String(b._id), (merged.get(String(b._id)) || 0) + (b.value || 0));
    }
    const growth = buildSeries(period, [...merged].map(([_id, value]) => ({ _id, value })));

    const data = {
      period,
      stats: {
        coinsEarned: round(session.earnedCoins + gift.giftCoins),
        totalCoins: wallet?.coinBalance || 0,
        minutes: round(session.totalSeconds / 60),
        gifts: { count: gift.giftCount || 0, coins: round(gift.giftCoins) },
      },
      growth,
    };

    await setCache(cacheKey, data, 60);
    return data;
  }

  /**
   * Recent sessions for the listener, period-filtered + paginated.
   */
  async getRecentSessions(userId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });

    const { start, end } = getPeriodRange(query.period || 'today');
    const matchQuery = {
      listenerId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: start, $lte: end },
    };

    const { total, data } = await communicationSessionRepository.getPaginatedListenerSessions(
      matchQuery,
      sort,
      skip,
      limit,
    );

    return formatPaginatedResponse(data, total, page, limit);
  }

  async createListenerByAgent(agentId, data) {
    const { name, username, email, phone, country, profileStatus } = data;

    // Validate unique email
    const existingEmail = await userRepository.findOne({ email });
    if (existingEmail) throw new ApiError(400, 'Email already in use');

    // Validate unique username
    const existingUsername = await userRepository.findOne({ username });
    if (existingUsername) throw new ApiError(400, 'Username already in use');

    // Validate unique phone
    if (phone) {
      const existingPhone = await userRepository.findOne({ mobileNumber: phone });
      if (existingPhone) throw new ApiError(400, 'Phone number already in use');
    }

    // Split name
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0] || 'Listener';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create user with a secure temporary password
    const crypto = await import('crypto');
    const tempPassword = crypto.randomBytes(16).toString('hex');

    // Resolve country
    const CountryModel = (await import('../modules/country.model.js')).default;
    const resolvedCountry = await CountryModel.findOne({ name: { $regex: `^${country}$`, $options: 'i' } });

    const user = await userRepository.create({
      firstName,
      lastName,
      username,
      email,
      mobileNumber: phone || undefined,
      password: tempPassword,
      type: 'LISTENER',
      country: resolvedCountry?._id || null,
      countryCode: resolvedCountry?.code || undefined,
      profileCompleted: profileStatus === 'completed'
    });

    const magicLoginToken = crypto.randomBytes(32).toString('hex');

    const profile = await this.repository.create({
      userId: user._id,
      createdByAgentId: agentId,
      profileStatus,
      kycStatus: 'PENDING',
      magicLoginToken,
      country: resolvedCountry?._id || null
    });

    await Promise.all([
      bumpCacheVersion('users'),
      bumpCacheVersion('listeners')
    ]);

    return {
      user,
      profile,
      magicLoginToken
    };
  }
}

export default new ListenerService();
