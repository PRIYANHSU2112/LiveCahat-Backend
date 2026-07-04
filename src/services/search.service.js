import ListenerProfile from '../modules/listener-profile.model.js';
import User from '../modules/user.model.js';
import Language from '../modules/language.model.js';
import mongoose from 'mongoose';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

class SearchService {

  /**
   * USER-FACING: Search listeners by name, country code, and language.
   * Only shows APPROVED, non-deleted, non-blocked listeners.
   *
   * Query Params:
   *   q          – name keyword (fuzzy, case-insensitive)
   *   country    – countryCode on user (e.g. "IN", "US")
   *   language   – Language ObjectId or language name/code
   *   category   – listener category (e.g. "Friendly Talk")
   *   availability – ONLINE | OFFLINE | BUSY
   *   page, limit, sortBy, sortOrder
   */
  async searchListeners(queryParams) {
    const { page, limit, skip, sort } = getPaginationOptions(queryParams);

    // ── 1. Resolve language filter to ObjectId if provided as name/code ──
    let languageId = null;
    if (queryParams.language) {
      const isObjectId = mongoose.Types.ObjectId.isValid(queryParams.language);
      if (isObjectId) {
        languageId = new mongoose.Types.ObjectId(queryParams.language);
      } else {
        const lang = await Language.findOne({
          $or: [
            { name: { $regex: queryParams.language, $options: 'i' } },
            { code: queryParams.language.toUpperCase() },
          ],
        }).lean();
        if (lang) languageId = lang._id;
      }
    }

    // ── 2. Build ListenerProfile match stage ─────────────────────────────
    const profileMatch = { kycStatus: 'APPROVED' };
    if (queryParams.availability) profileMatch.availability = queryParams.availability;
    if (queryParams.category) profileMatch.categories = queryParams.category;
    if (languageId) profileMatch.languages = languageId;

    // ── 3. Build User match stage ─────────────────────────────────────────
    const userMatch = { isDeleted: false, isBlocked: false };
    if (queryParams.country) {
      userMatch.countryCode = queryParams.country.toUpperCase();
    }
    if (queryParams.q) {
      const regex = { $regex: queryParams.q, $options: 'i' };
      userMatch.$or = [
        { firstName: regex },
        { lastName: regex },
        // fullName search: match first + last concatenated
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: queryParams.q,
              options: 'i',
            },
          },
        },
      ];
    }

    // ── 4. Aggregation pipeline ───────────────────────────────────────────
    const pipeline = [
      { $match: profileMatch },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $match: { ...Object.fromEntries(Object.entries(userMatch).map(([k, v]) => [`user.${k}`, v])) } },
      // Populate languages
      {
        $lookup: {
          from: 'languages',
          localField: 'languages',
          foreignField: '_id',
          as: 'languageDetails',
        },
      },
      // Project only the fields users need
      {
        $project: {
          _id: 1,
          userId: 1,
          bio: 1,
          profilePhotos: 1,
          categories: 1,
          chatRate: 1,
          voiceRate: 1,
          videoRate: 1,
          avgRating: 1,
          totalRatings: 1,
          totalSessions: 1,
          availability: 1,
          isFeatured: 1,
          followersCount: 1,
          anchorLevel: 1,
          'languageDetails.name': 1,
          'languageDetails.code': 1,
          'languageDetails.flagUrl': 1,
          'user._id': 1,
          'user.firstName': 1,
          'user.lastName': 1,
          'user.profileImage': 1,
          'user.countryCode': 1,
          'user.isOnline': 1,
          'user.currentLevel': 1,
          'user.totalXp': 1,
        },
      },
      { $sort: sort },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const result = await ListenerProfile.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return formatPaginatedResponse(data, total, page, limit);
  }

  /**
   * ADMIN-FACING: Full global search across Users AND Listeners.
   * Supports all fields: name, email, mobile, country, language,
   * user type, KYC status, availability, blocked/deleted status, date range.
   *
   * Query Params:
   *   q            – name / email / mobile keyword
   *   type         – CUSTOMER | LISTENER | ADMIN | AGENT
   *   country      – countryCode
   *   language     – Language ObjectId or name/code (listeners only)
   *   category     – listener category (listeners only)
   *   kycStatus    – PENDING | UNDER_REVIEW | APPROVED | REJECTED (listeners only)
   *   availability – ONLINE | OFFLINE | BUSY (listeners only)
   *   isBlocked    – true | false
   *   isDeleted    – true | false
   *   gender       – MALE | FEMALE | OTHER
   *   dateFrom     – ISO date (createdAt >=)
   *   dateTo       – ISO date (createdAt <=)
   *   minEarnings  – minimum totalEarnings on listener profile
   *   maxEarnings  – maximum totalEarnings on listener profile
   *   minRating    – minimum avgRating on listener profile
   *   page, limit, sortBy, sortOrder
   */
  async adminGlobalSearch(queryParams) {
    const { page, limit, skip, sort } = getPaginationOptions(queryParams);

    // ── 1. Resolve language ObjectId ──────────────────────────────────────
    let languageId = null;
    if (queryParams.language) {
      const isObjectId = mongoose.Types.ObjectId.isValid(queryParams.language);
      if (isObjectId) {
        languageId = new mongoose.Types.ObjectId(queryParams.language);
      } else {
        const lang = await Language.findOne({
          $or: [
            { name: { $regex: queryParams.language, $options: 'i' } },
            { code: queryParams.language.toUpperCase() },
          ],
        }).lean();
        if (lang) languageId = lang._id;
      }
    }

    // ── 2. Build User-level match ─────────────────────────────────────────
    const userMatch = {};

    // Keyword search: name, email, mobile
    if (queryParams.q) {
      const regex = { $regex: queryParams.q, $options: 'i' };
      userMatch.$or = [
        { firstName: regex  },
        { lastName: regex },
        { email: regex },
        { mobileNumber: regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: queryParams.q,
              options: 'i',
            },
          },
        },
      ];
    }

    if (queryParams.type) userMatch.type = queryParams.type;
    if (queryParams.country) userMatch.countryCode = queryParams.country.toUpperCase();
    if (queryParams.gender) userMatch.gender = queryParams.gender;

    // Boolean filters
    if (queryParams.isBlocked !== undefined) {
      userMatch.isBlocked = queryParams.isBlocked === 'true';
    }
    if (queryParams.isDeleted !== undefined) {
      userMatch.isDeleted = queryParams.isDeleted === 'true';
    } else {
      // Admins see non-deleted users by default unless explicitly asked for deleted
      // (Don't forcibly exclude — admin may want to see deleted users)
    }

    // Date range
    if (queryParams.dateFrom || queryParams.dateTo) {
      userMatch.createdAt = {};
      if (queryParams.dateFrom) userMatch.createdAt.$gte = new Date(queryParams.dateFrom);
      if (queryParams.dateTo) userMatch.createdAt.$lte = new Date(queryParams.dateTo);
    }

    // Language on user schema (User also has a languages[] field)
    if (languageId) userMatch.languages = languageId;

    // ── 3. Build ListenerProfile match (for additional listener filters) ──
    const listenerProfileMatch = {};
    if (queryParams.kycStatus) listenerProfileMatch.kycStatus = queryParams.kycStatus;
    if (queryParams.availability) listenerProfileMatch.availability = queryParams.availability;
    if (queryParams.category) listenerProfileMatch.categories = queryParams.category;
    if (languageId) listenerProfileMatch.languages = languageId;
    if (queryParams.minEarnings !== undefined) {
      listenerProfileMatch.totalEarnings = { ...listenerProfileMatch.totalEarnings, $gte: Number(queryParams.minEarnings) };
    }
    if (queryParams.maxEarnings !== undefined) {
      listenerProfileMatch.totalEarnings = { ...listenerProfileMatch.totalEarnings, $lte: Number(queryParams.maxEarnings) };
    }
    if (queryParams.minRating !== undefined) {
      listenerProfileMatch.avgRating = { $gte: Number(queryParams.minRating) };
    }

    const hasListenerFilters = Object.keys(listenerProfileMatch).length > 0;

    // ── 4. Aggregation pipeline on User collection ────────────────────────
    const pipeline = [
      { $match: userMatch },
      // Join listener profile (left join so we still get non-listeners)
      {
        $lookup: {
          from: 'listenerprofiles',
          localField: '_id',
          foreignField: 'userId',
          as: 'listenerProfile',
        },
      },
      {
        $addFields: {
          listenerProfile: { $arrayElemAt: ['$listenerProfile', 0] },
        },
      },
      // If listener-specific filters were provided, filter by them
      ...(hasListenerFilters
        ? [
          {
            $match: Object.fromEntries(
              Object.entries(listenerProfileMatch).map(([k, v]) => [`listenerProfile.${k}`, v])
            ),
          },
        ]
        : []),
      // Populate user's languages
      {
        $lookup: {
          from: 'languages',
          localField: 'languages',
          foreignField: '_id',
          as: 'languageDetails',
        },
      },
      // Populate listener's languages (may differ from user.languages)
      {
        $lookup: {
          from: 'languages',
          localField: 'listenerProfile.languages',
          foreignField: '_id',
          as: 'listenerLanguageDetails',
        },
      },
      // Project all relevant fields for admin view
      {
        $project: {
          password: 0,
          blockedUsers: 0,
          unlockedAvatars: 0,
          unlockedStickers: 0,
        },
      },
      { $sort: sort },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const result = await User.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return formatPaginatedResponse(data, total, page, limit);
  }
}

export default new SearchService();
