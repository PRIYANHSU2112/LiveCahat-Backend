import CommunicationConfig from '../modules/communication-config.model.js';
import adminCommunicationRepository from '../repositories/admin-communication.repository.js';
import communicationSessionService from './communication-session.service.js';
import SessionSegment from '../modules/session-segment.model.js';
import ApiError from '../utils/ApiError.js';
import { getUtcTodayRange } from '../utils/date-filter.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import { getSocketIo } from '../utils/socket.util.js';
import { emitToSession } from '../utils/socket-room.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';

const CACHE_NS = 'admin:communication';
const STATS_TTL = 30;
const DETAIL_TTL = 60;
const CONFIG_TTL = 120;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const resolvePeriodRange = (query = {}) => {
  if (query.dateFrom && query.dateTo) {
    return {
      start: new Date(query.dateFrom),
      end: new Date(query.dateTo),
    };
  }

  const now = new Date();
  switch (query.period) {
    case '24h':
      return { start: new Date(now.getTime() - MS_PER_DAY), end: now };
    case '7d':
      return { start: new Date(now.getTime() - 7 * MS_PER_DAY), end: now };
    case '30d':
      return { start: new Date(now.getTime() - 30 * MS_PER_DAY), end: now };
    case 'today':
    default: {
      const { start } = getUtcTodayRange();
      return { start, end: now };
    }
  }
};

const buildListMatch = (query) => {
  const match = {};
  if (query.status && query.status !== 'all') {
    match.status = query.status;
  }

  if (query.period || (query.dateFrom && query.dateTo)) {
    const { start, end } = resolvePeriodRange(query);
    match.createdAt = { $gte: start, $lte: end };
  }

  return match;
};

class AdminCommunicationService {
  async getConfig() {
    const key = `${CACHE_NS}:config`;
    const cached = await getCache(key);
    if (cached) return cached;

    let config = await CommunicationConfig.findOne().lean();
    if (!config) {
      config = (await CommunicationConfig.create({})).toObject();
    }

    await setCache(key, config, CONFIG_TTL);
    return config;
  }

  async updateConfig(data) {
    const config = await CommunicationConfig.findOneAndUpdate(
      {},
      { $set: data },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    await deleteCache(`${CACHE_NS}:config`);
    return config;
  }

  async getStats(query = {}) {
    const mode = query.mode ?? 'all';
    const period = query.period ?? 'today';
    const cacheKey = `${CACHE_NS}:stats:${mode}:${period}:${query.dateFrom ?? ''}:${query.dateTo ?? ''}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { start, end } = resolvePeriodRange(query);
    const stats = await adminCommunicationRepository.getSessionStats({ start, end, mode });

    const payload = {
      period: { start, end, label: period },
      ...stats,
    };

    await setCache(cacheKey, payload, STATS_TTL);
    return payload;
  }

  async listSessions(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions(query);
    const mode = query.mode ?? 'all';
    const matchQuery = buildListMatch(query);

    const { total, data } = await adminCommunicationRepository.getPaginatedSessions({
      matchQuery,
      mode,
      search: query.search?.trim() || null,
      sort,
      skip,
      limit,
    });

    return formatPaginatedResponse(data, total, page, limit);
  }

  async countSessionsForExport(query = {}) {
    return adminCommunicationRepository.countSessionsForExport({
      matchQuery: buildListMatch(query),
      mode: query.mode ?? 'all',
      search: query.search?.trim() || null,
    });
  }

  iterateSessionsForExport(query = {}, batchSize = 500) {
    return adminCommunicationRepository.iterateSessionsForExport({
      matchQuery: buildListMatch(query),
      mode: query.mode ?? 'all',
      search: query.search?.trim() || null,
      batchSize,
    });
  }

  async getLiveSessions(query = {}) {
    const mode = query.mode ?? 'all';
    const limit = parseInt(query.limit, 10) || 50;
    const sessions = await adminCommunicationRepository.getLiveSessions({ mode, limit });
    return { sessions, count: sessions.length };
  }

  async getSessionDetail(sessionId) {
    const cacheKey = `${CACHE_NS}:detail:${sessionId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const session = await adminCommunicationRepository.getSessionDetail(sessionId);
    if (!session) {
      throw new ApiError(404, 'Session not found');
    }

    await setCache(cacheKey, session, DETAIL_TTL);
    return session;
  }

  async forceEndSession(sessionId, adminId) {
    const session = await communicationSessionService.getItemById(sessionId);
    if (!session) {
      throw new ApiError(404, 'Session not found');
    }
    if (session.status !== 'ONGOING') {
      throw new ApiError(400, 'Only ongoing sessions can be force-ended');
    }

    const lastSegment = await SessionSegment.findOne({ sessionId })
      .sort({ startTime: -1 })
      .select('mode')
      .lean();

    const mode = lastSegment?.mode ?? 'CHAT';
    const io = getSocketIo();
    const event =
      mode === 'CHAT' ? SERVER_EVENTS.CHAT_ENDED : SERVER_EVENTS.CALL_ENDED;

    if (io) {
      emitToSession(io, sessionId, event, {
        sessionId: sessionId.toString(),
        reason: 'ADMIN_FORCE_END',
        endedBy: adminId?.toString(),
      });
    }

    const ended = await communicationSessionService.endSession(sessionId, 'ADMIN_FORCE_END');
    await deleteCache(`${CACHE_NS}:detail:${sessionId}`);

    return ended;
  }
}

export default new AdminCommunicationService();
