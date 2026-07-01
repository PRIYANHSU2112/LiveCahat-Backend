import listenerService from './listener.service.js';
import presenceService from './presence.service.js';
import communicationSessionService from './communication-session.service.js';
import listenerRepository from '../repositories/listener.repository.js';
import countryRepository from '../repositories/country.repository.js';
import Language from '../modules/language.model.js';
import MatchConfig from '../modules/match-config.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import Wallet from '../modules/wallet.model.js';
import ApiError from '../utils/ApiError.js';
import mongoose from 'mongoose';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, getCacheVersion, deleteCache, bumpCacheVersion } from '../utils/redis.util.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';

const CANDIDATE_POOL_LIMIT = 25;
const DISCOVER_CACHE_TTL = 60;
const STICKY_MATCH_TTL_SECONDS = 300;
const MATCH_CONFIG_CACHE_TTL = 60;

const DISCOVER_SORTS = {
  combined: { anchorLevel: -1, avgRating: -1, totalRatings: -1, followersCount: -1, _id: -1 },
  rating: { avgRating: -1, totalRatings: -1, anchorLevel: -1, _id: -1 },
  anchor_level: { anchorLevel: -1, avgRating: -1, totalRatings: -1, _id: -1 },
  featured: { isFeatured: -1, anchorLevel: -1, avgRating: -1, followersCount: -1, _id: -1 },
  popular: { followersCount: -1, totalSessions: -1, anchorLevel: -1, avgRating: -1, _id: -1 },
};

const getRateForMode = (profile, mode) => {
  switch (mode) {
    case 'AUDIO':
      return profile.voiceRate || 0;
    case 'VIDEO':
      return profile.videoRate || 0;
    default:
      return profile.chatRate || 0;
  }
};

const getListenerUserId = (doc) => {
  const id = doc.userId?._id || doc.userId;
  return id?.toString?.() || String(id);
};

const formatListenerCard = (doc) => {
  const user = doc.user || {};
  return {
    listenerId: getListenerUserId(doc),
    firstName: user.firstName,
    lastName: user.lastName,
    profileImage: user.profileImage || doc.profilePhotos?.[0] || null,
    avgRating: doc.avgRating ?? 0,
    totalRatings: doc.totalRatings ?? 0,
    chatRate: doc.chatRate ?? 0,
    voiceRate: doc.voiceRate ?? 0,
    videoRate: doc.videoRate ?? 0,
    availability: doc.availability,
    isFeatured: !!doc.isFeatured,
    followersCount: doc.followersCount ?? 0,
    bio: doc.bio,
    categories: doc.categories || [],
    languages: doc.languageDetails || [],
    country: doc.countryDetails || null,
    anchorLevel: doc.anchorLevel,
  };
};

const buildExcludeSet = (customerId, excludeListenerIds = []) => {
  const set = new Set([customerId.toString()]);
  for (const id of excludeListenerIds) {
    if (id) set.add(id.toString());
  }
  return set;
};

const scoreCandidate = (doc, customer, languageFilter) => {
  const reasons = ['ONLINE', 'KYC_APPROVED'];
  let score = 0;

  const listenerLangIds = new Set(
    (doc.languageDetails || []).map((l) => l._id?.toString()).filter(Boolean)
  );
  const customerLangIds = (customer.languages || []).map((l) => l?.toString?.() || String(l));

  const languageTarget = languageFilter?.toString();
  if (languageTarget && listenerLangIds.has(languageTarget)) {
    score += 100;
    reasons.push('LANGUAGE_MATCH');
  } else if (customerLangIds.some((id) => listenerLangIds.has(id))) {
    score += 80;
    reasons.push('LANGUAGE_MATCH');
  }

  const customerCountry = customer.country?.toString?.() || customer.country;
  const listenerCountry = doc.countryDetails?._id?.toString();
  if (customerCountry && listenerCountry && customerCountry === listenerCountry) {
    score += 50;
    reasons.push('COUNTRY_MATCH');
  }

  if (doc.isFeatured) {
    score += 30;
    reasons.push('FEATURED');
  }

  score += (doc.anchorLevel || 0) * 20;
  score += (doc.avgRating || 0) * 10;
  score += Math.min(doc.followersCount || 0, 1000) / 100;

  return { score, reasons };
};

const compareRankedCandidates = (a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  const anchorDiff = (b.doc.anchorLevel || 0) - (a.doc.anchorLevel || 0);
  if (anchorDiff !== 0) return anchorDiff;
  const ratingDiff = (b.doc.avgRating || 0) - (a.doc.avgRating || 0);
  if (ratingDiff !== 0) return ratingDiff;
  const featuredDiff = (b.doc.isFeatured ? 1 : 0) - (a.doc.isFeatured ? 1 : 0);
  if (featuredDiff !== 0) return featuredDiff;
  return getListenerUserId(a.doc).localeCompare(getListenerUserId(b.doc));
};

class MatchService {
  /**
   * Get singleton match config (cached).
   */
  async getMatchConfig() {
    const cacheKey = KEYS.matchConfigCache();
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    let config = await MatchConfig.findOne().lean();
    if (!config) {
      config = (await MatchConfig.create({})).toObject();
    }

    const payload = {
      instantMatchFee: config.instantMatchFee ?? 0,
      isEnabled: config.isEnabled !== false,
    };
    await setCache(cacheKey, payload, MATCH_CONFIG_CACHE_TTL);
    return payload;
  }

  /**
   * Admin: update singleton match config.
   */
  async updateMatchConfig(data) {
    const config = await MatchConfig.findOneAndUpdate({}, { $set: data }, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }).lean();

    await deleteCache(KEYS.matchConfigCache());

    return {
      instantMatchFee: config.instantMatchFee ?? 0,
      isEnabled: config.isEnabled !== false,
    };
  }

  /**
   * Customer-facing fee info for the app UI.
   */
  async getMatchFee() {
    const config = await this.getMatchConfig();
    return {
      instantMatchFee: config.instantMatchFee,
      isEnabled: config.isEnabled,
    };
  }

  /**
   * Fetch ONLINE listener candidates via the cached home feed, verify live presence,
   * apply wallet pre-check, then rank and return the best match.
   */
  async instantMatch(customerId, customer, options = {}) {
    const {
      mode = 'CHAT',
      language,
      country,
      category,
      excludeListenerIds = [],
      refresh = false,
    } = options;

    const matchConfig = await this.getMatchConfig();
    if (!matchConfig.isEnabled) {
      throw new ApiError(503, 'Instant match is currently unavailable.');
    }

    const instantMatchFee = matchConfig.instantMatchFee ?? 0;
    const alreadyPaid = !refresh && (await this._isMatchFeePaid(customerId));

    const [activeSession, wallet] = await Promise.all([
      communicationSessionService.getActiveSessionForUser(customerId),
      Wallet.findOne({ userId: customerId }).select('coinBalance').lean(),
    ]);

    if (activeSession) {
      throw new ApiError(409, 'You are already in an active session.');
    }

    let coinBalance = wallet?.coinBalance ?? 0;

    if (!alreadyPaid && instantMatchFee > 0 && coinBalance < instantMatchFee) {
      throw new ApiError(
        402,
        `Insufficient balance. You need at least ${instantMatchFee} coins for instant match.`
      );
    }
    const excludeSet = buildExcludeSet(customerId, excludeListenerIds);
    const resolvedLanguage = language ?? customer.languages?.[0] ?? null;
    const resolvedCountry = country ?? customer.country ?? customer.countryCode ?? null;

    let picked = null;
    let relaxedLanguage = false;
    let relaxedCountry = false;
    let stickyMatch = false;

    if (!refresh) {
      const stickyListenerId = await this._getStickyMatch(customerId);
      if (stickyListenerId) {
        picked = await this._tryStickyMatch({
          stickyListenerId,
          customer,
          mode,
          coinBalance,
          excludeSet,
          languageFilter: resolvedLanguage,
          countryFilter: resolvedCountry,
          category,
        });
        if (picked) stickyMatch = true;
      }
    }

    if (!picked) {
      const result = await this._findWithFallbacks({
        customer,
        mode,
        coinBalance,
        excludeSet,
        languageFilter: resolvedLanguage,
        countryFilter: resolvedCountry,
        category,
        requireAffordable: true,
      });
      picked = result.picked;
      relaxedLanguage = result.relaxedLanguage;
      relaxedCountry = result.relaxedCountry;
    }

    if (!picked) {
      throw new ApiError(404, 'No suitable partner available right now. Please try again later.');
    }

    if (picked.insufficientFunds) {
      throw new ApiError(
        402,
        `Insufficient balance. You need at least ${picked.minRequiredRate} coins to start a ${mode} session.`
      );
    }

    const matchReasons = [...picked.reasons];
    if (stickyMatch) matchReasons.unshift('STICKY_MATCH');
    if (relaxedLanguage) matchReasons.push('LANGUAGE_RELAXED');
    if (relaxedCountry) matchReasons.push('COUNTRY_RELAXED');

    const listener = formatListenerCard(picked.doc);
    await this._setStickyMatch(customerId, listener.listenerId);

    let matchFeeCharged = 0;
    let balanceAfter = coinBalance;

    if (!alreadyPaid && instantMatchFee > 0) {
      const charge = await this._chargeInstantMatchFee(customerId, instantMatchFee);
      matchFeeCharged = instantMatchFee;
      balanceAfter = charge.balanceAfter;
      await this._setMatchFeePaid(customerId);
    }

    return {
      listenerId: listener.listenerId,
      listener,
      matchReasons,
      instantMatchFee,
      matchFeeCharged,
      balanceAfter,
      nextStep: mode === 'CHAT'
        ? 'Emit socket request_chat with listenerId'
        : 'POST /calls/initiate or emit socket request_call with listenerId and mode',
    };
  }

  /**
   * Lightweight availability probe — no wallet debit or session mutation.
   */
  async matchStatus(customer, options = {}) {
    const { language, country, category } = options;
    const resolvedLanguage = language ?? customer.languages?.[0] ?? null;
    const resolvedCountry = country ?? customer.country ?? customer.countryCode ?? null;

    const { picked } = await this._findWithFallbacks({
      customer,
      mode: 'CHAT',
      coinBalance: Infinity,
      excludeSet: new Set(),
      languageFilter: resolvedLanguage,
      countryFilter: resolvedCountry,
      category,
      requireAffordable: false,
    });

    return {
      available: !!picked && !picked.insufficientFunds,
      onlineCount: picked?.onlineCount ?? 0,
    };
  }

  /**
   * Discover listeners for the match/browse flow — paginated, filterable,
   * sorted by anchor level + rating. Country defaults to the customer's profile.
   * Mongo page is Redis-cached; live availability is batch-overlaid on every response.
   */
  async discoverListeners(customer, queryParams = {}) {
    const { page, limit, skip } = getPaginationOptions(queryParams);
    const sortKey = DISCOVER_SORTS[queryParams.sort] ? queryParams.sort : 'combined';
    const sort = DISCOVER_SORTS[sortKey];

    const sameCountry = queryParams.sameCountry !== false;
    let countryInput = queryParams.country ?? null;
    if (!countryInput && sameCountry) {
      countryInput = customer.country ?? customer.countryCode ?? null;
    }

    const baseFilters = this._normalizeDiscoverFilters(queryParams, countryInput);
    let countryRelaxed = false;

    let result = await this._fetchDiscoverPage({
      filters: baseFilters,
      userMatch: this._buildDiscoverUserMatch(queryParams.q),
      q: queryParams.q,
      sort,
      sortKey,
      page,
      limit,
      skip,
    });

    if (
      !result.docs.length
      && queryParams.relaxCountry
      && baseFilters.countryId
    ) {
      countryRelaxed = true;
      result = await this._fetchDiscoverPage({
        filters: { ...baseFilters, countryId: null },
        userMatch: this._buildDiscoverUserMatch(queryParams.q),
        q: queryParams.q,
        sort,
        sortKey,
        page,
        limit,
        skip,
      });
    }

    const docs = await this._overlayDiscoverPresence(result.docs);

    return {
      ...formatPaginatedResponse(docs, result.total, page, limit),
      appliedFilters: {
        sort: sortKey,
        sameCountry,
        country: countryRelaxed ? null : (countryInput || null),
        countryRelaxed,
        minRating: baseFilters.minRating ?? null,
        maxRating: baseFilters.maxRating ?? null,
        minAnchorLevel: baseFilters.minAnchorLevel ?? null,
        maxAnchorLevel: baseFilters.maxAnchorLevel ?? null,
        anchorLevel: baseFilters.anchorLevel ?? null,
        language: queryParams.language || null,
        category: queryParams.category || null,
        status: queryParams.status || null,
        q: queryParams.q || null,
      },
    };
  }

  _normalizeDiscoverFilters(queryParams, countryInput) {
    if (
      queryParams.minRating !== undefined
      && queryParams.maxRating !== undefined
      && Number(queryParams.maxRating) < Number(queryParams.minRating)
    ) {
      throw new ApiError(400, 'maxRating must be greater than or equal to minRating.');
    }

    return {
      language: queryParams.language || null,
      countryId: countryInput,
      category: queryParams.category || null,
      status: queryParams.status || null,
      minRating: queryParams.minRating,
      maxRating: queryParams.maxRating,
      minAnchorLevel: queryParams.minAnchorLevel,
      maxAnchorLevel: queryParams.maxAnchorLevel,
      anchorLevel: queryParams.anchorLevel,
    };
  }

  _buildDiscoverUserMatch(q) {
    const userMatch = { 'user.isDeleted': false, 'user.isBlocked': false };
    if (!q?.trim()) return userMatch;

    const regex = { $regex: q.trim(), $options: 'i' };
    userMatch.$or = [
      { 'user.firstName': regex },
      { 'user.lastName': regex },
      {
        $expr: {
          $regexMatch: {
            input: { $concat: [{ $ifNull: ['$user.firstName', ''] }, ' ', { $ifNull: ['$user.lastName', ''] }] },
            regex: q.trim(),
            options: 'i',
          },
        },
      },
    ];
    return userMatch;
  }

  async _fetchDiscoverPage({ filters, userMatch, q, sort, sortKey, page, limit, skip }) {
    const version = await getCacheVersion('listeners');
    const cacheKey = `match:discover:v${version}:${JSON.stringify({ filters, q: q || '', sortKey, page, limit })}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const [languageId, countryId] = await Promise.all([
      this._resolveLanguageId(filters.language),
      this._resolveCountryId(filters.countryId),
    ]);

    const profileMatch = { kycStatus: 'APPROVED' };
    if (filters.status) profileMatch.availability = filters.status;
    if (languageId) profileMatch.languages = languageId;
    if (countryId) profileMatch.country = countryId;
    if (filters.category) profileMatch.categories = filters.category;

    if (filters.anchorLevel !== undefined && filters.anchorLevel !== '') {
      profileMatch.anchorLevel = Number(filters.anchorLevel);
    } else {
      const anchorRange = {};
      if (filters.minAnchorLevel !== undefined && filters.minAnchorLevel !== '') {
        anchorRange.$gte = Number(filters.minAnchorLevel);
      }
      if (filters.maxAnchorLevel !== undefined && filters.maxAnchorLevel !== '') {
        anchorRange.$lte = Number(filters.maxAnchorLevel);
      }
      if (Object.keys(anchorRange).length) profileMatch.anchorLevel = anchorRange;
    }

    const ratingRange = {};
    if (filters.minRating !== undefined && filters.minRating !== '') {
      ratingRange.$gte = Number(filters.minRating);
    }
    if (filters.maxRating !== undefined && filters.maxRating !== '') {
      ratingRange.$lte = Number(filters.maxRating);
    }
    if (Object.keys(ratingRange).length) profileMatch.avgRating = ratingRange;

    const { total, data } = await listenerRepository.getHomeListeners(
      profileMatch,
      userMatch,
      sort,
      skip,
      limit
    );

    const payload = { total, docs: data };
    await setCache(cacheKey, payload, DISCOVER_CACHE_TTL);
    return payload;
  }

  async _resolveLanguageId(language) {
    if (!language) return null;
    if (mongoose.Types.ObjectId.isValid(language)) {
      return new mongoose.Types.ObjectId(language);
    }
    const lang = await Language.findOne({
      $or: [
        { name: { $regex: `^${language}$`, $options: 'i' } },
        { code: language.toUpperCase() },
      ],
    }).select('_id').lean();
    return lang ? lang._id : new mongoose.Types.ObjectId();
  }

  async _resolveCountryId(country) {
    if (!country) return null;
    const c = String(country).trim();
    if (mongoose.Types.ObjectId.isValid(c)) {
      return new mongoose.Types.ObjectId(c);
    }
    const resolved =
      (await countryRepository.findByCode(c)) ||
      (await countryRepository.findByDialCode(c)) ||
      (await countryRepository.findOne({ name: { $regex: `^${c}$`, $options: 'i' } }));
    return resolved ? resolved._id : new mongoose.Types.ObjectId();
  }

  async _overlayDiscoverPresence(docs) {
    if (!docs?.length) return [];

    const statusMap = await presenceService.getStatusBatch(docs.map(getListenerUserId));
    return docs.map((doc) => {
      const listenerId = getListenerUserId(doc);
      const liveStatus = statusMap.get(listenerId) || 'OFFLINE';
      const availability = liveStatus !== 'OFFLINE' ? liveStatus : doc.availability;

      return {
        ...formatListenerCard({ ...doc, availability }),
        isOnline: liveStatus !== 'OFFLINE',
        liveStatus,
      };
    });
  }

  /**
   * Try progressively relaxed filters when strict profile filters return no match.
   */
  async _findWithFallbacks({
    customer,
    mode,
    coinBalance,
    excludeSet,
    languageFilter,
    countryFilter,
    category,
    requireAffordable,
  }) {
    const attempts = [
      { languageFilter, countryFilter, relaxedLanguage: false, relaxedCountry: false },
    ];

    if (languageFilter) {
      attempts.push({ languageFilter: null, countryFilter, relaxedLanguage: true, relaxedCountry: false });
    }
    if (countryFilter) {
      attempts.push({ languageFilter, countryFilter: null, relaxedLanguage: false, relaxedCountry: true });
    }
    if (languageFilter && countryFilter) {
      attempts.push({ languageFilter: null, countryFilter: null, relaxedLanguage: true, relaxedCountry: true });
    } else if (languageFilter || countryFilter) {
      attempts.push({ languageFilter: null, countryFilter: null, relaxedLanguage: !!languageFilter, relaxedCountry: !!countryFilter });
    }

    const seen = new Set();
    for (const attempt of attempts) {
      const key = `${attempt.languageFilter || ''}|${attempt.countryFilter || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const picked = await this._pickBestMatch({
        customer,
        mode,
        coinBalance,
        excludeSet,
        languageFilter: attempt.languageFilter,
        countryFilter: attempt.countryFilter,
        category,
        requireAffordable,
      });

      if (picked && !picked.insufficientFunds) {
        return {
          picked,
          relaxedLanguage: attempt.relaxedLanguage,
          relaxedCountry: attempt.relaxedCountry,
        };
      }

      if (picked?.insufficientFunds) {
        return { picked, relaxedLanguage: false, relaxedCountry: false };
      }
    }

    return { picked: null, relaxedLanguage: false, relaxedCountry: false };
  }

  async _pickBestMatch({
    customer,
    mode,
    coinBalance,
    excludeSet,
    languageFilter,
    countryFilter,
    category,
    requireAffordable,
  }) {
    const query = {
      sort: 'rating',
      page: 1,
      limit: CANDIDATE_POOL_LIMIT,
    };
    if (languageFilter) query.language = languageFilter;
    if (countryFilter) query.country = countryFilter;

    const { docs } = await listenerService.getHomeListeners(query);
    if (!docs?.length) return null;

    let candidates = docs.filter((doc) => {
      const id = getListenerUserId(doc);
      if (excludeSet.has(id)) return false;
      if (category && !doc.categories?.includes(category)) return false;
      return getRateForMode(doc, mode) > 0;
    });

    if (!candidates.length) return null;

    const statusMap = await presenceService.getStatusBatch(candidates.map(getListenerUserId));
    candidates = candidates.filter((doc) => statusMap.get(getListenerUserId(doc)) === 'ONLINE');
    if (!candidates.length) return null;

    const onlineCount = candidates.length;

    if (requireAffordable) {
      const affordable = candidates.filter((doc) => coinBalance >= getRateForMode(doc, mode));
      if (!affordable.length) {
        const minRequiredRate = Math.min(...candidates.map((doc) => getRateForMode(doc, mode)));
        return { insufficientFunds: true, minRequiredRate, onlineCount };
      }
      candidates = affordable;
    }

    const ranked = candidates
      .map((doc) => {
        const { score, reasons } = scoreCandidate(doc, customer, languageFilter);
        return { doc, score, reasons };
      })
      .sort(compareRankedCandidates);

    const best = ranked[0];
    return { doc: best.doc, score: best.score, reasons: best.reasons, onlineCount };
  }

  async _getStickyMatch(customerId) {
    if (!redisClient.isRedisAvailable) return null;
    try {
      return await redisClient.get(KEYS.matchSticky(customerId));
    } catch {
      return null;
    }
  }

  async _setStickyMatch(customerId, listenerId) {
    if (!redisClient.isRedisAvailable || !listenerId) return;
    try {
      await redisClient.set(
        KEYS.matchSticky(customerId),
        listenerId.toString(),
        'EX',
        STICKY_MATCH_TTL_SECONDS
      );
    } catch {
      // non-critical
    }
  }

  async _tryStickyMatch({
    stickyListenerId,
    customer,
    mode,
    coinBalance,
    excludeSet,
    languageFilter,
    countryFilter,
    category,
  }) {
    const id = stickyListenerId.toString();
    if (excludeSet.has(id)) return null;

    const liveStatus = await presenceService.getStatus(id);
    if (liveStatus !== 'ONLINE') return null;

    const query = { sort: 'rating', page: 1, limit: CANDIDATE_POOL_LIMIT };
    if (languageFilter) query.language = languageFilter;
    if (countryFilter) query.country = countryFilter;

    const { docs } = await listenerService.getHomeListeners(query);
    let doc = docs.find((row) => getListenerUserId(row) === id);

    if (!doc && countryFilter) {
      const relaxed = { sort: 'rating', page: 1, limit: CANDIDATE_POOL_LIMIT };
      if (languageFilter) relaxed.language = languageFilter;
      const fallback = await listenerService.getHomeListeners(relaxed);
      doc = fallback.docs.find((row) => getListenerUserId(row) === id);
    }

    if (!doc) return null;
    if (category && !doc.categories?.includes(category)) return null;

    const rate = getRateForMode(doc, mode);
    if (rate <= 0 || coinBalance < rate) return null;

    const { score, reasons } = scoreCandidate(doc, customer, languageFilter);
    return { doc, score, reasons, onlineCount: 1 };
  }

  async _isMatchFeePaid(customerId) {
    if (!redisClient.isRedisAvailable) return false;
    try {
      const paid = await redisClient.get(KEYS.matchPaid(customerId));
      return paid === '1';
    } catch {
      return false;
    }
  }

  async _setMatchFeePaid(customerId) {
    if (!redisClient.isRedisAvailable) return;
    try {
      await redisClient.set(
        KEYS.matchPaid(customerId),
        '1',
        'EX',
        STICKY_MATCH_TTL_SECONDS
      );
    } catch {
      // non-critical
    }
  }

  async _chargeInstantMatchFee(customerId, fee) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let wallet = await Wallet.findOne({ userId: customerId }).session(session);
      if (!wallet) {
        throw new ApiError(402, 'Insufficient balance for instant match.');
      }
      if (wallet.coinBalance < fee) {
        throw new ApiError(402, `Insufficient balance. You need at least ${fee} coins for instant match.`);
      }

      wallet.coinBalance -= fee;
      wallet.totalSpent += fee;
      await wallet.save({ session });

      const [coinTx] = await CoinTransaction.create([{
        userId: customerId,
        type: 'DEBIT',
        amount: fee,
        balanceAfter: wallet.coinBalance,
        referenceType: 'MATCH',
        description: 'Instant match fee',
      }], { session });

      await session.commitTransaction();
      session.endSession();

      const userIdStr = customerId.toString();
      await Promise.all([
        deleteCache(`wallet:user:${userIdStr}`),
        bumpCacheVersion(`coin_transactions:user:${userIdStr}`),
      ]);

      return {
        balanceAfter: wallet.coinBalance,
        transactionId: coinTx._id.toString(),
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
}

export default new MatchService();
