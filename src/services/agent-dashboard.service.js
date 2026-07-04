import { randomUUID } from 'crypto';
import redisClient from '../config/redis.js';
import agentDashboardRepository from '../repositories/agent-dashboard.repository.js';
import agentRepository from '../repositories/agent.repository.js';
import agentAnalyticsRepository from '../repositories/agent-analytics.repository.js';
import { getCache, setCache, getCacheVersion, bumpCacheVersion } from '../utils/redis.util.js';
import { getSocketIo } from '../utils/socket.util.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';
import logger from '../utils/logger.util.js';

const CACHE_NS_PREFIX = 'agent:dashboard';
const SUMMARY_TTL = 60;
const CHARTS_TTL = 120;
const LIVE_DEBOUNCE_SECONDS = 2;

const DAILY_BUCKET_LABELS = ['00h', '04h', '08h', '12h', '16h', '20h'];

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const calcTrend = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return round(((current - previous) / previous) * 100);
};

const commissionFrom = (revenue, rate) => round((revenue * rate) / 100);

const PERIOD_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const resolveDashboardPeriodWindows = (period = '7d') => {
  const durationMs = PERIOD_MS[period] || PERIOD_MS['7d'];
  const currentEnd = new Date();
  const currentStart = new Date(currentEnd.getTime() - durationMs);
  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);
  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
};

const startOfToday = () => {
  const end = new Date();
  const localNow = new Date(end.toLocaleString('en-US', { timeZone: DASHBOARD_TZ }));
  const startLocal = new Date(localNow);
  startLocal.setHours(0, 0, 0, 0);
  const tzOffsetMs = localNow.getTime() - end.getTime();
  return new Date(startLocal.getTime() - tzOffsetMs);
};

const buildTrendCard = (label, currentValue, previousValue, spark = []) => ({
  label,
  value: round(currentValue),
  trend: calcTrend(currentValue, previousValue),
  positive: currentValue >= previousValue,
  spark,
});

const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const startOfIsoWeek = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
};

class AgentDashboardService {
  async bumpCache(agentId) {
    await bumpCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
  }

  agentRoom(agentId) {
    return `agent:${agentId}`;
  }

  async getLiveSnapshot(agentId) {
    const todayStart = startOfToday();
    const [onlineListeners, activeSessions, earnings, newRegistrations, activeSessionFeed] =
      await Promise.all([
      agentDashboardRepository.countOnlineListeners(agentId),
      agentDashboardRepository.countActiveSessions(agentId),
      agentDashboardRepository.sumEarningsInRange(
        await agentDashboardRepository.getListenerIdsForAgent(agentId),
        todayStart,
        new Date(),
      ),
      agentDashboardRepository.countTodayRegistrations(agentId, todayStart),
      agentDashboardRepository.listActiveSessionsForAgent(agentId),
    ]);

    return {
      onlineListeners,
      activeSessions,
      revenueToday: round(earnings.total),
      newRegistrations,
      activeSessionFeed,
    };
  }

  emitLiveSnapshot(agentId, snapshot) {
    const io = getSocketIo();
    if (!io) return;
    io.to(this.agentRoom(agentId)).emit('agent:dashboard:live', snapshot);
  }

  async emitLiveUpdate(agentId) {
    if (!redisClient.isRedisAvailable) {
      const snapshot = await this.getLiveSnapshot(agentId);
      this.emitLiveSnapshot(agentId, snapshot);
      return;
    }

    const debounceKey = KEYS.agentLiveDebounce(agentId);
    try {
      const set = await redisClient.set(debounceKey, '1', 'EX', LIVE_DEBOUNCE_SECONDS, 'NX');
      if (!set) return;
    } catch (err) {
      logger.error(`[AgentDashboard emitLiveUpdate] ${err.message}`);
    }

    const snapshot = await this.getLiveSnapshot(agentId);
    this.emitLiveSnapshot(agentId, snapshot);
  }

  async recordActivity(agentId, { type, text, meta }) {
    if (!agentId) return null;

    const item = {
      id: randomUUID(),
      type,
      text,
      createdAt: new Date().toISOString(),
      meta: meta || undefined,
    };

    await agentDashboardRepository.pushActivity(agentId, item);

    const io = getSocketIo();
    if (io) {
      io.to(this.agentRoom(agentId)).emit('agent:activity', item);
    }

    return item;
  }

  async recordActivityForListener(listenerUserId, payload) {
    const agentId = await agentDashboardRepository.getAgentIdForListener(listenerUserId);
    if (!agentId) return null;
    const item = await this.recordActivity(agentId, payload);
    await this.emitLiveUpdate(agentId);
    return item;
  }

  async _pendingCommissionAt(agentId, commissionRate, asOf) {
    const listenerIds = await agentDashboardRepository.getListenerIdsForAgent(agentId);
    const lifetime = await agentDashboardRepository.sumEarningsInRange(
      listenerIds,
      new Date(0),
      asOf,
    );
    const withdrawals = await agentRepository.getWithdrawalTotals(agentId);
    const totalCommission = commissionFrom(lifetime.total, commissionRate);
    const paidCommission = commissionFrom(withdrawals.paidCoins, commissionRate);
    return Math.max(
      0,
      round(totalCommission - paidCommission - commissionFrom(withdrawals.pendingWithdrawalCoins, commissionRate)),
    );
  }

  async getSummary(agentId, query = {}) {
    const period = query.period || '7d';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:summary:v${version}:${agentId}:${period}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const windows = resolveDashboardPeriodWindows(period);
    const { current, previous } = windows;

    const [listenerIds, commissionRate] = await Promise.all([
      agentDashboardRepository.getListenerIdsForAgent(agentId),
      agentRepository.getAgentCommissionRate(agentId),
    ]);

    const [
      totalListenersCurrent,
      totalListenersPrevious,
      activeCurrent,
      activePrevious,
      newCurrent,
      newPrevious,
      revenueCurrent,
      revenuePrevious,
      pendingCurrent,
      pendingPrevious,
    ] = await Promise.all([
      agentDashboardRepository.countApprovedListenersAt(agentId, current.end),
      agentDashboardRepository.countApprovedListenersAt(agentId, previous.end),
      agentDashboardRepository.countActiveListenersInRange(listenerIds, current.start, current.end),
      agentDashboardRepository.countActiveListenersInRange(listenerIds, previous.start, previous.end),
      agentDashboardRepository.countNewListenersInRange(agentId, current.start, current.end),
      agentDashboardRepository.countNewListenersInRange(agentId, previous.start, previous.end),
      agentDashboardRepository.sumEarningsInRange(listenerIds, current.start, current.end),
      agentDashboardRepository.sumEarningsInRange(listenerIds, previous.start, previous.end),
      this._pendingCommissionAt(agentId, commissionRate, current.end),
      this._pendingCommissionAt(agentId, commissionRate, previous.end),
    ]);

    const commissionCurrent = commissionFrom(revenueCurrent.total, commissionRate);
    const commissionPrevious = commissionFrom(revenuePrevious.total, commissionRate);
    const growthPct = calcTrend(newCurrent, newPrevious);

    const cards = [
      buildTrendCard('Total Listeners', totalListenersCurrent, totalListenersPrevious),
      buildTrendCard('Active Listeners', activeCurrent, activePrevious),
      buildTrendCard('New Listeners', newCurrent, newPrevious),
      buildTrendCard('Total Revenue', revenueCurrent.total, revenuePrevious.total),
      buildTrendCard('Agent Commission', commissionCurrent, commissionPrevious),
      buildTrendCard('Pending Commission', pendingCurrent, pendingPrevious),
      buildTrendCard('Period Earnings', revenueCurrent.total, revenuePrevious.total),
      {
        label: 'Listener Growth',
        value: growthPct,
        trend: growthPct,
        positive: newCurrent >= newPrevious,
        spark: [],
      },
    ];

    const payload = { period, cards };
    await setCache(cacheKey, payload, SUMMARY_TTL);
    return payload;
  }

  async getCharts(agentId, query = {}) {
    const period = query.period || '7d';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:charts:v${version}:${agentId}:${period}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const windows = resolveDashboardPeriodWindows(period);
    const { current } = windows;
    const [listenerIds, commissionRate] = await Promise.all([
      agentDashboardRepository.getListenerIdsForAgent(agentId),
      agentRepository.getAgentCommissionRate(agentId),
    ]);

    const monthsForGrowth = period === '24h' ? 1 : period === '7d' ? 1 : 3;
    const earningsGranularity = period === '24h' ? 'daily' : 'weekly';

    const [growthSeries, earningsMap, weeklySeries, dailyActiveMap] = await Promise.all([
      agentAnalyticsRepository.getListenerGrowthSeries(agentId, monthsForGrowth),
      agentDashboardRepository.getEarningsSeries(
        listenerIds,
        current.start,
        current.end,
        earningsGranularity,
      ),
      agentRepository.getWeeklyCommissionSeries(listenerIds, period === '24h' ? 2 : period === '7d' ? 2 : 6),
      agentDashboardRepository.getDailyActiveBuckets(listenerIds, startOfToday(), new Date()),
    ]);

    const listenerGrowth = growthSeries.map((row) => ({
      name: row.name,
      total: row.value,
      active: row.value2,
    }));

    let revenueTrend = [];
    if (period === '24h') {
      revenueTrend = DAILY_BUCKET_LABELS.map((name, i) => ({
        name,
        revenue: round(earningsMap.get(String(i)) || 0),
      }));
    } else if (period === '7d') {
      const cursor = startOfIsoWeek(current.start);
      for (let i = 0; i < 7; i++) {
        const day = new Date(cursor);
        day.setDate(cursor.getDate() + i);
        const key = formatDateKey(day);
        revenueTrend.push({
          name: day.toLocaleString('en-US', { weekday: 'short', timeZone: DASHBOARD_TZ }),
          revenue: round(earningsMap.get(key) || 0),
        });
      }
    } else {
      const cursor = new Date(current.start);
      cursor.setHours(0, 0, 0, 0);
      while (cursor <= current.end) {
        const key = formatDateKey(cursor);
        revenueTrend.push({
          name: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: DASHBOARD_TZ }),
          revenue: round(earningsMap.get(key) || 0),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const commissionTrend = weeklySeries.map((row) => ({
      name: row.name,
      commission: commissionFrom(row.commission ?? row.value, commissionRate),
    }));

    const dailyActive = DAILY_BUCKET_LABELS.map((name, i) => ({
      name,
      listeners: dailyActiveMap.get(String(i)) || 0,
    }));

    const payload = {
      period,
      listenerGrowth,
      revenueTrend,
      commissionTrend,
      dailyActive,
    };

    await setCache(cacheKey, payload, CHARTS_TTL);
    return payload;
  }

  async getActivity(agentId, query = {}) {
    const limit = query.limit || 20;
    const cursor = query.cursor || 0;
    return agentDashboardRepository.listActivity(agentId, limit, cursor);
  }
}

export default new AgentDashboardService();
