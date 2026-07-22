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
import { resolveAdminAnalyticsRange } from '../utils/date-filter.util.js';
import logger from '../utils/logger.util.js';
import anchorLevelService from './anchor-level.service.js';
import withdrawalService from './withdrawal.service.js';
import Language from '../modules/language.model.js';
import countryRepository from '../repositories/country.repository.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { getDateBoundaries, buildComparison, formatDateKey } from '../utils/stats.util.js';

const round = (n) => Math.round(n || 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const MS_DAY = 24 * 60 * 60 * 1000;
const RECEIVED_GIFT_TYPES = ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'];

const formatDurationSecs = (avgDur) => {
  const mins = Math.floor((avgDur || 0) / 60);
  const secs = Math.round((avgDur || 0) % 60);
  return `${mins}m ${secs}s`;
};

const formatInr = (amount) =>
  `₹${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const buildDailyChartBuckets = (start, end) => {
  const days = [];
  const cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  ));
  const endDay = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  ));
  while (cursor <= endDay) {
    days.push({ name: cursor.toISOString().slice(0, 10), value: 0, value2: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

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
    if (queryParams.kycStatus) {
      if (queryParams.kycStatus.startsWith('!')) {
        matchQuery.kycStatus = { $ne: queryParams.kycStatus.substring(1) };
      } else if (queryParams.kycStatus.includes(',')) {
        matchQuery.kycStatus = { $in: queryParams.kycStatus.split(',') };
      } else {
        matchQuery.kycStatus = queryParams.kycStatus;
      }
    }
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

    const withdrawalConfig = await withdrawalService.getConfig();
    const conversionCoins = withdrawalConfig.conversionCoins || 1000;
    const conversionInr = withdrawalConfig.conversionInr || 100;
    const rate = conversionCoins > 0 ? conversionInr / conversionCoins : 0;

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

        const coins = Number(doc.totalEarnings) || 0;
        return {
          ...doc,
          availability: status,
          inrEarnings: formatInr(round2(coins * rate)),
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
   * Shared filter builder for agent listener list + search endpoints.
   * @returns {{ matchQuery: Object, userMatch: Object }}
   */
  async _buildAgentListenerFilters(agentId, queryParams = {}) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);

    let countryId;
    if (queryParams.country && queryParams.country !== 'All') {
      const c = queryParams.country.trim();
      if (mongoose.Types.ObjectId.isValid(c)) {
        countryId = new mongoose.Types.ObjectId(c);
      } else {
        const country =
          (await countryRepository.findByCode(c)) ||
          (await countryRepository.findOne({ name: { $regex: `^${c}$`, $options: 'i' } }));
        countryId = country ? country._id : new mongoose.Types.ObjectId();
      }
    }

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

    if (queryParams.minRevenue !== undefined || queryParams.maxRevenue !== undefined) {
      matchQuery.totalEarnings = {};
      if (queryParams.minRevenue !== undefined) matchQuery.totalEarnings.$gte = Number(queryParams.minRevenue);
      if (queryParams.maxRevenue !== undefined) matchQuery.totalEarnings.$lte = Number(queryParams.maxRevenue);
    }

    if (queryParams.accountStatus === 'pending') matchQuery.kycStatus = 'PENDING';
    else if (queryParams.accountStatus === 'active') matchQuery.kycStatus = 'APPROVED';

    if (queryParams.level !== undefined && queryParams.level !== 'All') {
      matchQuery.anchorLevel = Number(queryParams.level);
    }

    const userMatch = { 'userId.isDeleted': false };
    if (queryParams.accountStatus === 'active') userMatch['userId.isBlocked'] = false;
    else if (queryParams.accountStatus === 'blocked') userMatch['userId.isBlocked'] = true;

    const searchTerm = (queryParams.search || queryParams.q || '').trim();
    if (searchTerm) {
      const regex = { $regex: searchTerm, $options: 'i' };
      userMatch.$or = [
        { 'userId.firstName': regex },
        { 'userId.lastName': regex },
        { 'userId.username': regex },
        { 'userId.email': regex },
        { 'userId.mobileNumber': regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ['$userId.firstName', ' ', '$userId.lastName'] },
              regex: searchTerm,
              options: 'i',
            },
          },
        },
      ];
    }

    return { matchQuery, userMatch };
  }

  _mapAgentSearchRow(doc) {
    const user = doc.userId || {};
    const accountStatus = user.isBlocked
      ? 'blocked'
      : doc.kycStatus === 'PENDING'
        ? 'pending'
        : 'active';

    return {
      id: doc._id?.toString(),
      userId: user._id?.toString() ?? null,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || '—',
      username: user.username ?? null,
      mobileNumber: user.mobileNumber ?? null,
      profileImage: user.profileImage ?? null,
      country: doc.country
        ? { name: doc.country.name, code: doc.country.code, flagUrl: doc.country.flagUrl }
        : null,
      accountStatus,
      kycStatus: doc.kycStatus,
      liveStatus: doc.availability,
      anchorLevel: doc.anchorLevel ?? 0,
    };
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

    const { matchQuery, userMatch } = await this._buildAgentListenerFilters(agentId, queryParams);

    const { total, data } = await this.repository.getAgentListenersPaginated(
      matchQuery,
      userMatch,
      sort,
      skip,
      limit
    );

    const response = formatPaginatedResponse(data, total, page, limit);
    await setCache(cacheKey, response, 30);
    return { ...response, docs: await this._overlayPresence(response.docs) };
  }

  /**
   * AGENT PANEL — lightweight listener search for top-bar autocomplete.
   * Compact payload, max 20 results per page, version-cached (30s).
   *
   * @param {String} agentId
   * @param {Object} queryParams  q, country, accountStatus, kycStatus, liveStatus, page, limit
   */
  async searchAgentListeners(agentId, queryParams = {}) {
    const normalized = {
      ...queryParams,
      search: (queryParams.q || queryParams.search || '').trim(),
    };

    const page = parseInt(queryParams.page, 10) || 1;
    const limit = Math.min(parseInt(queryParams.limit, 10) || 10, 20);
    const skip = (page - 1) * limit;
    const sort = { createdAt: -1 };

    const version = await getCacheVersion('listeners');
    const cacheKey = `agent_search:v${version}:${agentId}:${JSON.stringify({
      ...normalized,
      page,
      limit,
    })}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return { ...cached, docs: await this._overlaySearchLiveStatus(cached.docs) };
    }

    const { matchQuery, userMatch } = await this._buildAgentListenerFilters(agentId, normalized);

    const { total, data } = await this.repository.getAgentListenersPaginated(
      matchQuery,
      userMatch,
      sort,
      skip,
      limit,
      { compact: true }
    );

    const withPresence = await this._overlayPresence(data);
    const mapped = withPresence.map((doc) => {
      const row = this._mapAgentSearchRow(doc);
      return { ...row, liveStatus: doc.availability ?? row.liveStatus };
    });

    const response = formatPaginatedResponse(mapped, total, page, limit);
    await setCache(cacheKey, response, 30);
    return response;
  }

  /**
   * Refresh liveStatus on cached compact search rows.
   */
  async _overlaySearchLiveStatus(docs) {
    if (!docs.length) return docs;
    const { default: presenceService } = await import('./presence.service.js');
    return Promise.all(
      docs.map(async (doc) => {
        if (!doc.userId) return doc;
        const status = await presenceService.getStatus(doc.userId);
        return { ...doc, liveStatus: status };
      })
    );
  }

  /**
   * AGENT PANEL — KPI stat cards.
   *
   * Returns nine cards; the comparison cards include a count, percentage change
   * and trend (monthly for blocked/pending/approved totals + blocked-this-month,
   * daily for peak-today and today-approved). "In session" / "idle" / "in review"
   * are bare counts. Peak comes from the per-agent Redis daily-max key maintained
   * by the presence service.
   */
  async getAgentStats(agentId) {
    const version = await getCacheVersion('listeners');
    const cacheKey = `agent_stats:v${version}:${agentId}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const boundaries = getDateBoundaries();
    const objectId = new mongoose.Types.ObjectId(agentId);

    const raw = await this.repository.getAgentStats(objectId, boundaries);

    // Daily peak of concurrently-online listeners (today vs yesterday).
    const todayKey = KEYS.agentPeak(agentId, formatDateKey(boundaries.startOfToday));
    const yesterdayKey = KEYS.agentPeak(agentId, formatDateKey(boundaries.startOfYesterday));
    const [peakTodayRaw, peakYesterdayRaw] = await Promise.all([
      redisClient.get(todayKey),
      redisClient.get(yesterdayKey),
    ]);
    const peakToday = Number(peakTodayRaw) || 0;
    const peakYesterday = Number(peakYesterdayRaw) || 0;

    const stats = {
      totalListeners: { count: raw.total },
      onlineNow: { count: raw.onlineNow },
      totalBlocked: buildComparison(raw.blockedTotal, raw.blockedPrevMonth),
      blockedThisMonth: buildComparison(raw.blockedThisMonth, raw.blockedLastMonth),
      inSession: { count: raw.inSession },
      idle: { count: raw.idle },
      peakToday: buildComparison(peakToday, peakYesterday),
      pendingListeners: buildComparison(raw.pendingTotal, raw.pendingPrevMonth),
      inReview: { count: raw.inReview },
      totalApproved: buildComparison(raw.approvedTotal, raw.approvedPrevMonth),
      todayApproved: buildComparison(raw.approvedToday, raw.approvedYesterday),
    };

    await setCache(cacheKey, stats, 30);
    return stats;
  }

  async approveOrRejectListener(listenerId, data) {
    const { kycStatus, rejectionReason } = data;

    const profile = await this.repository.findById(listenerId, '', '', false);
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    profile.kycStatus = kycStatus;
    profile.rejectionReason = kycStatus === 'REJECTED' ? rejectionReason : undefined;
    // Stamp the approval time so agent stat cards can compute "today approved"
    // and month-over-month approved trends.
    if (kycStatus === 'APPROVED') profile.kycApprovedAt = new Date();

    await profile.save();

    await Promise.all([
      deleteCache(`listener:${profile.userId}`),
      bumpCacheVersion('listeners')
    ]);

    if (kycStatus === 'APPROVED' && profile.createdByAgentId) {
      const agentId = profile.createdByAgentId.toString();
      const { default: agentDashboardService } = await import('./agent-dashboard.service.js');
      const user = await userRepository.findById(profile.userId, 'firstName lastName');
      const name = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
        : 'Listener';
      await agentDashboardService.recordActivity(agentId, {
        type: 'register',
        text: `New listener ${name || 'registered'} registered`,
      });
      await agentDashboardService.emitLiveUpdate(agentId);
      await agentDashboardService.bumpCache(agentId);
    }

    // In a real app, send push notification/email to listener here
    return profile;
  }

  async getAdminStats() {
    const version = await getCacheVersion('listeners');
    const cacheKey = `admin_listeners_stats:v${version}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const [approved, pending, rejected, totalListenersObj, avgRatingObj, totalEarningsObj] = await Promise.all([
      this.repository.aggregate([{ $match: { kycStatus: 'APPROVED' } }, { $count: 'n' }]),
      this.repository.aggregate([{ $match: { kycStatus: 'PENDING' } }, { $count: 'n' }]),
      this.repository.aggregate([{ $match: { kycStatus: 'REJECTED' } }, { $count: 'n' }]),
      this.repository.aggregate([{ $count: 'n' }]),
      this.repository.aggregate([{ $match: { kycStatus: 'APPROVED' } }, { $group: { _id: null, avg: { $avg: '$avgRating' } } }]),
      this.repository.aggregate([{ $match: { kycStatus: 'APPROVED' } }, { $group: { _id: null, total: { $sum: '$totalEarnings' } } }])
    ]);
    
    const avgRating = avgRatingObj[0]?.avg || 0;
    const totalEarnings = totalEarningsObj[0]?.total || 0;

    const stats = {
      verified: { count: approved[0]?.n || 0 },
      pending: { count: pending[0]?.n || 0 },
      rejected: { count: rejected[0]?.n || 0 },
      total: { count: totalListenersObj[0]?.n || 0 },
      avgRating: { count: Number(avgRating.toFixed(2)) },
      totalEarnings: { count: totalEarnings }
    };
    await setCache(cacheKey, stats, 60);
    return stats;
  }

  async getAdminListenerPerformance(queryParams) {
    // Default to last 7 days when no date params (matches FE default preset)
    const rangeQuery = { ...queryParams };
    if (!rangeQuery.dateFrom && !rangeQuery.dateTo && !rangeQuery.year) {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * MS_DAY);
      rangeQuery.dateFrom = start.toISOString();
      rangeQuery.dateTo = end.toISOString();
    }

    const { start, end: resolvedEnd, label } = resolveAdminAnalyticsRange(rangeQuery);
    // Rolling presets (24h/7d/30d) send exact ISO dateTo; do not snap to end-of-UTC-day
    // or a "24h" filter becomes "24h ago → midnight tonight" and looks wrong.
    const end =
      rangeQuery.dateFrom && rangeQuery.dateTo
        ? new Date(rangeQuery.dateTo)
        : resolvedEnd;
    const daySpan = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / MS_DAY));
    const rangeKey = `${start.toISOString()}_${end.toISOString()}`;

    const version = await getCacheVersion('listeners');
    const statsCacheKey = `admin_listeners_performance_stats:v${version}:${rangeKey}`;

    let statsAndTrends = await getCache(statsCacheKey);
    if (!statsAndTrends) {
      const CommunicationSession = mongoose.model('CommunicationSession');
      const periodMatch = { createdAt: { $gte: start, $lte: end } };

      const [sessionFacet, trendRes] = await Promise.all([
        CommunicationSession.aggregate([
          { $match: periodMatch },
          {
            $facet: {
              completed: [
                { $match: { status: 'COMPLETED' } },
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 },
                    avgDuration: { $avg: '$duration' },
                    avgRating: { $avg: '$rating' },
                  },
                },
              ],
              ended: [
                {
                  $match: {
                    status: { $in: ['COMPLETED', 'MISSED', 'REJECTED', 'FAILED'] },
                  },
                },
                { $count: 'n' },
              ],
            },
          },
        ]),
        CommunicationSession.aggregate([
          { $match: { ...periodMatch, status: 'COMPLETED' } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              sessions: { $sum: 1 },
              avgRating: { $avg: '$rating' },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

      const sf = sessionFacet[0] ?? {};
      const completedRow = sf.completed?.[0] ?? {};
      const completedCount = completedRow.count ?? 0;
      const avgRating = completedRow.avgRating || 0;
      const sessionsPerDay = Math.round((completedCount / daySpan) * 10) / 10;
      const endedCount = sf.ended?.[0]?.n ?? 0;
      const completionRate =
        endedCount > 0 ? Math.round((completedCount / endedCount) * 100) : 100;
      const avgDurationStr = formatDurationSecs(completedRow.avgDuration ?? 0);

      const days = buildDailyChartBuckets(start, end);
      trendRes.forEach((t) => {
        const day = days.find((d) => d.name === t._id);
        if (day) {
          day.value = t.sessions;
          day.value2 = t.avgRating ? Math.round(t.avgRating * 10) / 10 : 0;
        }
      });

      statsAndTrends = {
        stats: [
          {
            label: 'Avg. Rating',
            value: String(Number(avgRating).toFixed(2)),
            tone: 'text-success bg-success/10',
          },
          {
            label: 'Sessions / Day',
            value: String(sessionsPerDay),
            tone: 'text-primary bg-accent',
          },
          {
            label: 'Completion Rate',
            value: `${completionRate}%`,
            tone: 'text-success bg-success/10',
          },
          {
            label: 'Avg. Duration',
            value: avgDurationStr,
            tone: 'text-foreground bg-muted',
          },
        ],
        chartData: days,
        rangeLabel: label,
      };

      await setCache(statsCacheKey, statsAndTrends, 30);
    }

    // ── Top Performers: period session + gift earnings, sort by period coins ──
    const { search = '', anchorLevel } = queryParams;
    const skipOptions = getPaginationOptions(queryParams);

    const matchQuery = { kycStatus: 'APPROVED' };
    if (anchorLevel !== undefined && anchorLevel !== '') {
      matchQuery.anchorLevel = Number(anchorLevel);
    }

    if (search) {
      const User = mongoose.model('User');
      const matchedUsers = await User.find({
        type: 'LISTENER',
        isDeleted: false,
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
        ],
      })
        .select('_id')
        .lean();
      matchQuery.userId = { $in: matchedUsers.map((u) => u._id) };
    }

    const ListenerProfile = mongoose.model('ListenerProfile');
    const CommunicationSession = mongoose.model('CommunicationSession');
    const GiftTransaction = mongoose.model('GiftTransaction');

    const profiles = await ListenerProfile.find(matchQuery)
      .select('_id userId avgRating anchorLevel')
      .populate('userId', 'firstName lastName email')
      .lean();

    const listenerUserIds = profiles
      .map((lp) => lp.userId?._id)
      .filter(Boolean);

    const periodMatch = { createdAt: { $gte: start, $lte: end } };
    const sessionByListener = new Map();
    const giftByListener = new Map();

    if (listenerUserIds.length) {
      const [sessionRows, giftRows] = await Promise.all([
        CommunicationSession.aggregate([
          {
            $match: {
              ...periodMatch,
              status: 'COMPLETED',
              listenerId: { $in: listenerUserIds },
            },
          },
          {
            $group: {
              _id: '$listenerId',
              earnedCoins: { $sum: '$totalCoinsEarned' },
              sessionCount: { $sum: 1 },
              avgDuration: { $avg: '$duration' },
              avgRating: { $avg: '$rating' },
            },
          },
        ]),
        GiftTransaction.aggregate([
          {
            $match: {
              ...periodMatch,
              status: 'SUCCESS',
              type: { $in: RECEIVED_GIFT_TYPES },
              receiverId: { $in: listenerUserIds },
            },
          },
          {
            $group: {
              _id: '$receiverId',
              giftCoins: { $sum: '$earningCoins' },
            },
          },
        ]),
      ]);

      for (const row of sessionRows) {
        sessionByListener.set(String(row._id), row);
      }
      for (const row of giftRows) {
        giftByListener.set(String(row._id), row.giftCoins ?? 0);
      }
    }

    const withdrawalConfig = await withdrawalService.getConfig();
    const conversionCoins = withdrawalConfig.conversionCoins || 1000;
    const conversionInr = withdrawalConfig.conversionInr || 100;
    const rate = conversionCoins > 0 ? conversionInr / conversionCoins : 0;

    const ranked = profiles.map((lp) => {
      const uid = String(lp.userId?._id || '');
      const session = sessionByListener.get(uid);
      const sessionCoins = session?.earnedCoins ?? 0;
      const giftCoins = giftByListener.get(uid) ?? 0;
      const periodCoins = sessionCoins + giftCoins;
      const inr = round2(periodCoins * rate);
      const name = lp.userId
        ? `${lp.userId.firstName || ''} ${lp.userId.lastName || ''}`.trim()
        : 'Listener';
      const periodRating = session?.avgRating;
      const ratingValue =
        periodRating != null && !Number.isNaN(periodRating)
          ? periodRating
          : lp.avgRating ?? 0;

      return {
        id: String(lp._id),
        listener: name || 'Listener',
        email: lp.userId?.email || '—',
        rating: Number(ratingValue).toFixed(2),
        sessions: session?.sessionCount ?? 0,
        avgDuration: formatDurationSecs(session?.avgDuration ?? 0),
        earnings: `${Number(periodCoins).toLocaleString('en-IN')} coins`,
        inrEarnings: formatInr(inr),
        periodCoins,
        anchorLevel: lp.anchorLevel ?? 0,
      };
    });

    ranked.sort((a, b) => {
      if (b.periodCoins !== a.periodCoins) return b.periodCoins - a.periodCoins;
      return b.sessions - a.sessions;
    });

    const totalDocs = ranked.length;
    const pageDocs = ranked
      .slice(skipOptions.skip, skipOptions.skip + skipOptions.limit)
      .map(({ periodCoins: _pc, ...row }) => row);

    const paginatedResponse = formatPaginatedResponse(
      pageDocs,
      totalDocs,
      skipOptions.page,
      skipOptions.limit,
    );

    return {
      stats: statsAndTrends.stats,
      chartData: statsAndTrends.chartData,
      rangeLabel: statsAndTrends.rangeLabel || label,
      performers: paginatedResponse,
    };
  }

  async getAdminAvailabilityMonitoring(queryParams) {
    const { period = 'day', search = "", status } = queryParams;
    const skipOptions = getPaginationOptions(queryParams);

    const mongoose = (await import('mongoose')).default;
    const CommunicationSession = mongoose.model('CommunicationSession');
    const ListenerProfile = mongoose.model('ListenerProfile');
    const User = mongoose.model('User');

    const listenersVersion = await getCacheVersion('listeners');
    const statsCacheKey = `listeners:availability:${period}:v${listenersVersion}`;
    let statsPayload = await getCache(statsCacheKey);

    if (!statsPayload) {
      // 1. Fetch Real-time Availability Counts (ONLINE, BUSY, OFFLINE)
      const [onlineCount, busyCount, offlineCount] = await Promise.all([
        ListenerProfile.countDocuments({ kycStatus: 'APPROVED', availability: 'ONLINE' }),
        ListenerProfile.countDocuments({ kycStatus: 'APPROVED', availability: 'BUSY' }),
        ListenerProfile.countDocuments({ kycStatus: 'APPROVED', availability: 'OFFLINE' })
      ]);

      // Live Average Wait Time (all time or today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const avgWaitRes = await CommunicationSession.aggregate([
        { $match: { status: 'COMPLETED', startTime: { $ne: null }, createdAt: { $gte: today } } },
        { $project: { waitTime: { $divide: [{ $subtract: ['$startTime', '$createdAt'] }, 1000] } } },
        { $group: { _id: null, avg: { $avg: '$waitTime' } } }
      ]);
      const liveAvgWaitSec = avgWaitRes[0]?.avg ?? 85; // fallback to 1m 25s
      const waitMins = Math.floor(liveAvgWaitSec / 60);
      const waitSecs = Math.round(liveAvgWaitSec % 60);
      const liveAvgWaitStr = `${waitMins}m ${waitSecs}s`;

      // 2. Fetch Period-based Stats and Trends (Percentage Changes)
      let currentStart, currentEnd, previousStart, previousEnd;
      if (period === 'month') {
        currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
        currentEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        previousEnd = currentStart;
      } else {
        currentStart = today;
        currentEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        previousStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        previousEnd = currentStart;
      }

      const [
        activeLCurrentIds,
        activeLPreviousIds,
        sessionsCurrent,
        sessionsPrevious,
        waitCurrentRes,
        waitPreviousRes,
      ] = await Promise.all([
        CommunicationSession.distinct('listenerId', {
          status: 'COMPLETED',
          createdAt: { $gte: currentStart, $lt: currentEnd },
        }),
        CommunicationSession.distinct('listenerId', {
          status: 'COMPLETED',
          createdAt: { $gte: previousStart, $lt: previousEnd },
        }),
        CommunicationSession.countDocuments({
          status: 'COMPLETED',
          createdAt: { $gte: currentStart, $lt: currentEnd },
        }),
        CommunicationSession.countDocuments({
          status: 'COMPLETED',
          createdAt: { $gte: previousStart, $lt: previousEnd },
        }),
        CommunicationSession.aggregate([
          { $match: { status: 'COMPLETED', startTime: { $ne: null }, createdAt: { $gte: currentStart, $lt: currentEnd } } },
          { $project: { waitTime: { $divide: [{ $subtract: ['$startTime', '$createdAt'] }, 1000] } } },
          { $group: { _id: null, avg: { $avg: '$waitTime' } } },
        ]),
        CommunicationSession.aggregate([
          { $match: { status: 'COMPLETED', startTime: { $ne: null }, createdAt: { $gte: previousStart, $lt: previousEnd } } },
          { $project: { waitTime: { $divide: [{ $subtract: ['$startTime', '$createdAt'] }, 1000] } } },
          { $group: { _id: null, avg: { $avg: '$waitTime' } } },
        ]),
      ]);

      const activeLCurrent = activeLCurrentIds.length;
      const activeLPrevious = activeLPreviousIds.length;
      const activeLDiff = activeLCurrent - activeLPrevious;
      const activeLPct = activeLPrevious > 0 ? Math.round((activeLDiff / activeLPrevious) * 100) : (activeLCurrent > 0 ? 100 : 0);

      const sessionsDiff = sessionsCurrent - sessionsPrevious;
      const sessionsPct = sessionsPrevious > 0 ? Math.round((sessionsDiff / sessionsPrevious) * 100) : (sessionsCurrent > 0 ? 100 : 0);

      const waitCurrent = waitCurrentRes[0]?.avg ?? 85;
      const waitPrevious = waitPreviousRes[0]?.avg ?? 85;
      const waitDiff = waitCurrent - waitPrevious;
      const waitPct = waitPrevious > 0 ? Math.round((waitDiff / waitPrevious) * 100) : 0;

      const waitCurrentMins = Math.floor(waitCurrent / 60);
      const waitCurrentSecs = Math.round(waitCurrent % 60);

      statsPayload = {
        realtime: {
          online: onlineCount,
          busy: busyCount,
          offline: offlineCount,
          avgWait: liveAvgWaitStr,
        },
        periodStats: [
          { label: 'Active Listeners', value: String(activeLCurrent), trend: Math.abs(activeLPct), positive: activeLPct >= 0 },
          { label: 'Total Sessions', value: String(sessionsCurrent), trend: Math.abs(sessionsPct), positive: sessionsPct >= 0 },
          { label: 'Avg. Wait Time', value: `${waitCurrentMins}m ${waitCurrentSecs}s`, trend: Math.abs(waitPct), positive: waitPct <= 0 },
        ],
      };

      await setCache(statsCacheKey, statsPayload, 30);
    }

    // 3. Paginated Listener availability board
    const matchQuery = { kycStatus: 'APPROVED' };
    if (status) {
      matchQuery.availability = status;
    }
    if (search) {
      const matchedUsers = await User.find({
        type: 'LISTENER',
        isDeleted: false,
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } }
        ]
      }).select('_id').lean();
      matchQuery.userId = { $in: matchedUsers.map(u => u._id) };
    }

    const totalDocs = await ListenerProfile.countDocuments(matchQuery);
    const docsRaw = await ListenerProfile.find(matchQuery)
      .skip(skipOptions.skip)
      .limit(skipOptions.limit)
      .populate('userId', 'firstName lastName email profileImage isOnline')
      .populate({ path: 'languages', select: 'name' })
      .lean();

    const docs = docsRaw.map(lp => {
      const name = lp.userId
        ? `${lp.userId.firstName || ''} ${lp.userId.lastName || ''}`.trim()
        : 'Listener';

      return {
        id: String(lp._id),
        userId: String(lp.userId?._id),
        listener: name,
        email: lp.userId?.email || '—',
        status: lp.availability || 'OFFLINE',
        queue: lp.totalSessions ?? 0,
        lastSeen: lp.userId?.isOnline ? 'Just now' : 'Offline',
        languages: lp.languages?.map(l => l.name) ?? []
      };
    });

    const paginatedResponse = formatPaginatedResponse(docs, totalDocs, skipOptions.page, skipOptions.limit);

    return {
      realtime: statsPayload.realtime,
      periodStats: statsPayload.periodStats,
      listeners: paginatedResponse
    };
  }

  async getListenerByIdForAdmin(listenerId) {
    const profile = await this.repository.findById(listenerId, '', [{ path: 'userId' }, { path: 'country' }]);
    if (!profile) throw new ApiError(404, 'Listener not found');
    return profile;
  }

  async updateListenerByAdmin(listenerId, data) {
    const profile = await this.repository.findById(listenerId, '', '', false);
    if (!profile) throw new ApiError(404, 'Listener not found');

    const allowedUpdates = ['chatRate', 'voiceRate', 'videoRate', 'bio', 'kycStatus', 'availability'];
    for (const key of allowedUpdates) {
      if (data[key] !== undefined) {
        profile[key] = data[key];
      }
    }
    await profile.save();

    if (data.mobileNumber !== undefined || data.email !== undefined || data.firstName !== undefined || data.lastName !== undefined) {
       const userUpdate = {};
       if (data.mobileNumber !== undefined) userUpdate.mobileNumber = data.mobileNumber;
       if (data.email !== undefined) userUpdate.email = data.email;
       if (data.firstName !== undefined) userUpdate.firstName = data.firstName;
       if (data.lastName !== undefined) userUpdate.lastName = data.lastName;
       await userRepository.updateById(profile.userId, userUpdate);
       await deleteCache(`user:${profile.userId}`);
    }

    await Promise.all([
      deleteCache(`listener:${profile.userId}`),
      bumpCacheVersion('listeners')
    ]);

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

  async getListenerByIdForAdmin(listenerId) {
    const profile = await this.repository.findById(listenerId, '', [
      { path: 'userId' },
      { path: 'languages' },
      { path: 'country' }
    ]);
      
    if (!profile) throw new ApiError(404, 'Listener profile not found');
    return profile;
  }

  async updateListenerByAdmin(listenerId, updateData) {
    // Because repository.findById returns a lean object by default unless specified, 
    // we use updateById for simplicity.
    const updated = await this.repository.updateById(listenerId, {
      $set: {
        chatRate: updateData.chatRate,
        voiceRate: updateData.voiceRate,
        videoRate: updateData.videoRate
      }
    });

    if (!updated) throw new ApiError(404, 'Listener profile not found');

    await bumpCacheVersion('listeners');
    return updated;
  }
}

export default new ListenerService();
