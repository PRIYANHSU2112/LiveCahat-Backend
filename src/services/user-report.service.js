import mongoose from 'mongoose';
import UserReport from '../modules/user-report.model.js';
import User from '../modules/user.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import Notification from '../modules/notification.model.js';
import userReportRepository from '../repositories/user-report.repository.js';
import reportReasonService from './report-reason.service.js';
import userService from './user.service.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { bumpCacheVersion } from '../utils/redis.util.js';
import { buildUtcCreatedAtFilter } from '../utils/date-filter.util.js';
import { emitToUser } from '../utils/socket.util.js';

const CACHE_NS = 'user:reports';
const USER_SUMMARY_SELECT = 'firstName lastName email mobileNumber profileImage type isBlocked';
const USER_POPULATE = [
  { path: 'reporterId', select: USER_SUMMARY_SELECT },
  { path: 'targetId', select: USER_SUMMARY_SELECT },
  { path: 'agentId', select: 'firstName lastName email type' },
  { path: 'sessionId', select: 'callerId listenerId status mode createdAt' },
  { path: 'resolvedBy', select: 'firstName lastName email type' },
];

const TERMINAL_STATUSES = ['RESOLVED', 'DISMISSED'];

class UserReportService {
  async createReport(user, body) {
    if (!['CUSTOMER', 'LISTENER'].includes(user.type)) {
      throw new ApiError(403, 'Only customers and listeners can submit reports');
    }

    if (user._id.toString() === body.targetId.toString()) {
      throw new ApiError(400, 'You cannot report yourself');
    }

    const target = await User.findOne({ _id: body.targetId, isDeleted: false })
      .select(USER_SUMMARY_SELECT)
      .lean();
    if (!target || target.isBlocked) {
      throw new ApiError(404, 'Target user not found or inactive');
    }

    this._assertAllowedPair(user.type, target.type);

    const duplicate = await UserReport.findOne({
      reporterId: user._id,
      targetId: target._id,
      status: 'OPEN',
    }).lean();
    if (duplicate) throw new ApiError(400, 'You already have an open report for this user');

    const reasons = await reportReasonService.validateActiveReasons(body.reasonIds);
    if (body.sessionId) {
      await this._assertSessionIncludesUsers(body.sessionId, user._id, target._id);
    }

    const agentId = await this._resolveAgentId(user, target);
    const report = await userReportRepository.create({
      reporterId: user._id,
      reporterType: user.type,
      targetId: target._id,
      targetType: target.type,
      reasonIds: reasons.map((reason) => reason._id),
      reasonLabels: reasons.map((reason) => reason.label),
      message: body.message.trim(),
      sessionId: body.sessionId || null,
      agentId,
    });

    await bumpCacheVersion(CACHE_NS);
    if (agentId) {
      this._notifyAgent(agentId, report, user, target).catch(() => {});
    }

    return this.getReportForUser(report._id, user);
  }

  async getMyReports(userId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });
    const filter = { reporterId: userId };

    const [docs, total] = await Promise.all([
      userReportRepository.findMany(filter, '', USER_POPULATE, sort, limit, skip),
      userReportRepository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  async getReportForUser(id, user) {
    const report = await userReportRepository.findById(id, '', USER_POPULATE);
    if (!report) throw new ApiError(404, 'Report not found');

    const ownerId = report.reporterId?._id ?? report.reporterId;
    if (ownerId.toString() !== user._id.toString() && user.type !== 'ADMIN') {
      throw new ApiError(403, 'You do not have permission to access this report');
    }
    return report;
  }

  async getAllReports(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });
    const filter = this._buildListFilter(query);

    const [docs, total] = await Promise.all([
      userReportRepository.findMany(filter, '', USER_POPULATE, sort, limit, skip),
      userReportRepository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  async getStats(query = {}) {
    const dateFilter = buildUtcCreatedAtFilter(query);
    const matchStage = Object.keys(dateFilter).length ? [{ $match: dateFilter }] : [];

    const [statusCounts, highRiskProxy] = await Promise.all([
      userReportRepository.aggregate([
        ...matchStage,
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      userReportRepository.countDocuments({
        ...dateFilter,
        status: 'OPEN',
        $expr: { $gte: [{ $size: '$reasonIds' }, 2] },
      }),
    ]);

    const counts = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    const { year, month, day } = query;
    return {
      open: counts.OPEN ?? 0,
      inReview: counts.IN_REVIEW ?? 0,
      resolved: counts.RESOLVED ?? 0,
      dismissed: counts.DISMISSED ?? 0,
      highRiskProxy,
      total: Object.values(counts).reduce((sum, n) => sum + n, 0),
      dateScope: {
        year: year ? parseInt(year, 10) : null,
        month: month ? parseInt(month, 10) : null,
        day: day ? parseInt(day, 10) : null,
      },
    };
  }

  async getReportById(id) {
    const report = await userReportRepository.findById(id, '', USER_POPULATE);
    if (!report) throw new ApiError(404, 'Report not found');
    return report;
  }

  async moderateReport(id, admin, body) {
    const update = {};
    if (body.status) {
      update.status = body.status;
      if (TERMINAL_STATUSES.includes(body.status)) {
        update.resolvedBy = admin._id;
        update.resolvedAt = new Date();
      }
    }
    if (body.adminNote !== undefined) update.adminNote = body.adminNote?.trim() || null;

    const report = await userReportRepository.updateById(id, update);
    if (!report) throw new ApiError(404, 'Report not found');

    if (body.blockTarget) {
      await userService.blockUser(report.targetId, { isBlocked: true });
    }

    await bumpCacheVersion(CACHE_NS);
    return this.getReportById(id);
  }

  async getAgentReports(agentId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });
    const filter = { ...this._buildListFilter(query), agentId };

    const [docs, total] = await Promise.all([
      userReportRepository.findMany(filter, '', USER_POPULATE, sort, limit, skip),
      userReportRepository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  async getAgentReportById(agentId, id) {
    const report = await userReportRepository.findOne({ _id: id, agentId }, '', USER_POPULATE);
    if (!report) throw new ApiError(403, 'You do not have access to this report');
    return report;
  }

  _assertAllowedPair(reporterType, targetType) {
    const valid =
      (reporterType === 'CUSTOMER' && targetType === 'LISTENER') ||
      (reporterType === 'LISTENER' && targetType === 'CUSTOMER');
    if (!valid) {
      throw new ApiError(400, 'Reports are allowed only between customers and listeners');
    }
  }

  async _assertSessionIncludesUsers(sessionId, reporterId, targetId) {
    const session = await CommunicationSession.findById(sessionId).select('callerId listenerId').lean();
    if (!session) throw new ApiError(404, 'Session not found');

    const participantIds = [session.callerId.toString(), session.listenerId.toString()];
    if (!participantIds.includes(reporterId.toString()) || !participantIds.includes(targetId.toString())) {
      throw new ApiError(400, 'Session does not include both report participants');
    }
  }

  async _resolveAgentId(user, target) {
    const listenerUserId = user.type === 'LISTENER' ? user._id : target._id;
    const profile = await ListenerProfile.findOne({ userId: listenerUserId })
      .select('createdByAgentId')
      .lean();
    return profile?.createdByAgentId || null;
  }

  async _notifyAgent(agentId, report, reporter, target) {
    const notification = await Notification.create({
      recipientId: agentId,
      senderId: reporter._id,
      title: 'New listener report',
      body: `${reporter.firstName || reporter.type} submitted a report involving ${target.firstName || target.type}.`,
      type: 'USER_REPORT',
      metadata: {
        reportId: report._id.toString(),
        route: '/agent/listener-reports',
      },
    });

    emitToUser(agentId.toString(), 'notification:new', {
      id: notification._id,
      type: 'USER_REPORT',
      title: notification.title,
      body: notification.body,
      metadata: { reportId: report._id.toString() },
      createdAt: notification.createdAt,
    });
  }

  _buildListFilter(query = {}) {
    const filter = { ...buildUtcCreatedAtFilter(query) };
    if (query.status) filter.status = query.status;
    if (query.reasonId && mongoose.Types.ObjectId.isValid(query.reasonId)) {
      filter.reasonIds = query.reasonId;
    }
    if (query.reporterType) filter.reporterType = query.reporterType;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.search?.trim()) {
      const regex = { $regex: query.search.trim(), $options: 'i' };
      filter.$or = [{ message: regex }, { reasonLabels: regex }];
    }
    return filter;
  }
}

export default new UserReportService();
