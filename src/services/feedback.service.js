import BaseService from './base.service.js';
import feedbackRepository from '../repositories/feedback.repository.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

const CACHE_NS = 'feedback';
const SUBMITTER_POPULATE = { path: 'userId', select: 'firstName lastName profileImage' };

class FeedbackService extends BaseService {
  constructor() {
    super(feedbackRepository);
  }

  /**
   * Any authenticated user (CUSTOMER / LISTENER / ADMIN) submits feedback.
   */
  async createFeedback(user, { category, message, rating }) {
    const feedback = await this.repository.create({
      userId: user._id,
      userType: user.type,
      category,
      message,
      rating,
    });

    await bumpCacheVersion(CACHE_NS);
    return feedback;
  }

  /**
   * Paginated list of the requesting user's own feedback (cached per user).
   */
  async getMyFeedback(userId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });

    const version = await getCacheVersion(CACHE_NS);
    const cacheKey = `${CACHE_NS}:me:${userId}:v${version}:${JSON.stringify({ page, limit, sort })}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const filter = { userId };
    const [docs, total] = await Promise.all([
      this.repository.findMany(filter, '', '', sort, limit, skip),
      this.repository.countDocuments(filter),
    ]);
    const response = formatPaginatedResponse(docs, total, page, limit);

    await setCache(cacheKey, response, 300); // 5 min
    return response;
  }

  /**
   * Admin: paginated feedback across all users with filters. Live (no cache).
   */
  async getAllFeedback(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });

    const filter = {};
    if (query.category) filter.category = query.category;
    if (query.status) filter.status = query.status;
    if (query.userType) filter.userType = query.userType;
    if (query.search) filter.message = { $regex: query.search.trim(), $options: 'i' };

    const [docs, total] = await Promise.all([
      this.repository.findMany(filter, '', SUBMITTER_POPULATE, sort, limit, skip),
      this.repository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  /**
   * Fetch a single feedback — owner or admin only.
   */
  async getFeedbackById(id, user) {
    const feedback = await this.repository.findById(id, '', SUBMITTER_POPULATE);
    if (!feedback) throw new ApiError(404, 'Feedback not found');

    this._assertOwnerOrAdmin(feedback, user);
    return feedback;
  }

  /**
   * Owner-only edit of category/message/rating, allowed only while OPEN.
   */
  async updateFeedback(id, user, body) {
    const feedback = await this.repository.findById(id);
    if (!feedback) throw new ApiError(404, 'Feedback not found');

    if (feedback.userId.toString() !== user._id.toString()) {
      throw new ApiError(403, 'You can only edit your own feedback.');
    }
    if (feedback.status !== 'OPEN') {
      throw new ApiError(400, 'Feedback can no longer be edited once it is being reviewed.');
    }

    const updated = await this.repository.updateById(id, body);
    await bumpCacheVersion(CACHE_NS);
    return updated;
  }

  /**
   * Admin: set status and/or write a response.
   */
  async moderateFeedback(id, admin, { status, adminResponse }) {
    const update = {};
    if (status !== undefined) update.status = status;
    if (adminResponse !== undefined) {
      update.adminResponse = adminResponse;
      update.respondedBy = admin._id;
      update.respondedAt = new Date();
    }

    const updated = await this.repository.updateById(id, update);
    if (!updated) throw new ApiError(404, 'Feedback not found');

    await bumpCacheVersion(CACHE_NS);
    return updated;
  }

  /**
   * Delete feedback — owner or admin.
   */
  async deleteFeedback(id, user) {
    const feedback = await this.repository.findById(id);
    if (!feedback) throw new ApiError(404, 'Feedback not found');

    this._assertOwnerOrAdmin(feedback, user);

    await this.repository.deleteById(id);
    await bumpCacheVersion(CACHE_NS);
    return { deleted: true };
  }

  _assertOwnerOrAdmin(feedback, user) {
    // userId may be populated (object with _id) or a raw ObjectId
    const ownerId = feedback.userId?._id ? feedback.userId._id : feedback.userId;
    const isOwner = ownerId.toString() === user._id.toString();
    if (!isOwner && user.type !== 'ADMIN') {
      throw new ApiError(403, 'You do not have permission to access this feedback.');
    }
  }
}

export default new FeedbackService();
