import agentRepository from '../repositories/agent.repository.js';
import { getCache, setCache, getCacheVersion, bumpCacheVersion } from '../utils/redis.util.js';
import { getPeriodRange } from '../utils/date.util.js';
import { formatPaginatedResponse, getPaginationOptions } from '../utils/pagination.util.js';

const CACHE_TTL = 60;
const CACHE_NS_PREFIX = 'agent:revenue';

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const calcTrend = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return round(((current - previous) / previous) * 100);
};

const commissionFrom = (revenue, rate) => round((revenue * rate) / 100);

const sparkFrom = (base) =>
  Array.from({ length: 10 }, (_, i) =>
    Math.max(0, Math.round(base * (0.7 + (i / 10) * 0.3) + (i % 3) * 2))
  );

const monthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const previousMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { start, end };
};

const previousDayRange = () => {
  const { start: todayStart } = getPeriodRange('today');
  const end = new Date(todayStart.getTime() - 1);
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

class AgentService {
  async _getContext(agentId) {
    const [listenerIds, commissionRate] = await Promise.all([
      agentRepository.getListenerIdsForAgent(agentId),
      agentRepository.getAgentCommissionRate(agentId),
    ]);
    return { listenerIds, commissionRate };
  }

  async bumpCache(agentId) {
    await bumpCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
  }

  async getSummary(agentId, query = {}) {
    const period = query.period || 'month';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:summary:v${version}:${agentId}:${period}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { listenerIds, commissionRate } = await this._getContext(agentId);
    const todayRange = getPeriodRange('today');
    const prevDay = previousDayRange();
    const prevMonth = previousMonthRange();
    const monthStartDate = monthStart();

    const [
      lifetime,
      todayEarn,
      monthEarn,
      prevDayEarn,
      prevMonthEarn,
      withdrawals,
    ] = await Promise.all([
      agentRepository.sumEarnings(listenerIds),
      agentRepository.sumEarnings(listenerIds, todayRange.start, todayRange.end),
      agentRepository.sumEarnings(listenerIds, monthStartDate, new Date()),
      agentRepository.sumEarnings(listenerIds, prevDay.start, prevDay.end),
      agentRepository.sumEarnings(listenerIds, prevMonth.start, prevMonth.end),
      agentRepository.getWithdrawalTotals(agentId),
    ]);

    const totalRevenue = lifetime.total;
    const totalCommission = commissionFrom(totalRevenue, commissionRate);
    const todayCommission = commissionFrom(todayEarn.total, commissionRate);
    const monthlyCommission = commissionFrom(monthEarn.total, commissionRate);
    const prevDayCommission = commissionFrom(prevDayEarn.total, commissionRate);
    const prevMonthCommission = commissionFrom(prevMonthEarn.total, commissionRate);

    const paidCommission = commissionFrom(withdrawals.paidCoins, commissionRate);
    const pendingCommission = Math.max(
      0,
      round(totalCommission - paidCommission - commissionFrom(withdrawals.pendingWithdrawalCoins, commissionRate))
    );

    const payload = {
      commissionPercentage: commissionRate,
      cards: [
        {
          label: 'Total Revenue',
          value: round(totalRevenue),
          trend: calcTrend(totalRevenue, prevMonthEarn.total),
          positive: totalRevenue >= prevMonthEarn.total,
          spark: sparkFrom(totalRevenue / 1000),
        },
        {
          label: 'Commission Earned',
          value: totalCommission,
          trend: calcTrend(totalCommission, prevMonthCommission),
          positive: totalCommission >= prevMonthCommission,
          spark: sparkFrom(totalCommission / 100),
        },
        {
          label: "Today's Commission",
          value: todayCommission,
          trend: calcTrend(todayCommission, prevDayCommission),
          positive: todayCommission >= prevDayCommission,
          spark: sparkFrom(todayCommission / 10),
        },
        {
          label: 'Monthly Commission',
          value: monthlyCommission,
          trend: calcTrend(monthlyCommission, prevMonthCommission),
          positive: monthlyCommission >= prevMonthCommission,
          spark: sparkFrom(monthlyCommission / 100),
        },
        {
          label: 'Pending Commission',
          value: pendingCommission,
          trend: calcTrend(pendingCommission, prevMonthCommission * 0.1),
          positive: false,
          spark: sparkFrom(pendingCommission / 50),
        },
        {
          label: 'Paid Commission',
          value: paidCommission,
          trend: calcTrend(paidCommission, prevMonthCommission * 0.8),
          positive: paidCommission >= prevMonthCommission * 0.8,
          spark: sparkFrom(paidCommission / 100),
        },
      ],
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getGraphs(agentId, query = {}) {
    const period = query.period || '6months';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:graphs:v${version}:${agentId}:${period}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { listenerIds, commissionRate } = await this._getContext(agentId);

    const [monthlySeries, weeklySeries, breakdown] = await Promise.all([
      agentRepository.getMonthlyRevenueSeries(listenerIds, 6),
      agentRepository.getWeeklyCommissionSeries(listenerIds, 6),
      agentRepository.getSourceBreakdown(listenerIds),
    ]);

    const monthlyRevenueData = monthlySeries.map((row) => ({
      name: row.name,
      value: round(row.value),
      value2: commissionFrom(row.value, commissionRate),
    }));

    const commissionTrendData = weeklySeries.map((row) => ({
      name: row.name,
      commission: commissionFrom(row.commission, commissionRate),
    }));

    const total = breakdown.total || 1;
    const revenueBreakdown = [
      { label: 'Gifts', value: round(breakdown.gifts), pct: round((breakdown.gifts / total) * 100) },
      { label: 'Calls', value: round(breakdown.calls), pct: round((breakdown.calls / total) * 100) },
    ].filter((row) => row.value > 0);

    const payload = { monthlyRevenueData, commissionTrendData, revenueBreakdown };
    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getHistory(agentId, query = {}) {
    const { page, limit, skip } = getPaginationOptions({
      page: query.page,
      limit: query.limit || 20,
    });
    const source = (query.source || 'all').toLowerCase();
    const status = (query.status || 'all').toLowerCase();
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:history:v${version}:${agentId}:${page}:${limit}:${source}:${status}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { listenerIds, commissionRate } = await this._getContext(agentId);

    const { total, docs } = await agentRepository.getCommissionHistory(listenerIds, {
      skip,
      limit,
      source: source === 'all' ? 'all' : source,
    });

    let rows = docs.map((row) => ({
      ...row,
      rate: commissionRate,
      commission: commissionFrom(row.amount, commissionRate),
    }));

    if (status !== 'all') {
      rows = rows.filter((row) => row.status === status);
    }

    const payload = formatPaginatedResponse(rows, total, page, limit);
    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }
}

export default new AgentService();
