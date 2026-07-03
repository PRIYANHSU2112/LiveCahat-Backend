import agentAnalyticsRepository from '../repositories/agent-analytics.repository.js';
import agentRepository from '../repositories/agent.repository.js';
import { getCache, setCache, getCacheVersion, bumpCacheVersion } from '../utils/redis.util.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';

const CACHE_TTL = 60;
const RETENTION_CACHE_TTL = 300;
const CACHE_NS_PREFIX = 'agent:analytics';

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const calcTrend = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return round(((current - previous) / previous) * 100);
};

const listenerPeriodToMonths = (period) => {
  const map = { '3months': 3, '6months': 6, '12months': 12 };
  return map[period] ?? 6;
};

const resolveRevenueRange = (period, dateFrom, dateTo) => {
  if (dateFrom && dateTo) {
    return { start: new Date(dateFrom), end: new Date(dateTo), period: 'custom' };
  }

  const end = new Date();
  const start = new Date(end);

  switch (period) {
    case 'month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case '3months':
      start.setMonth(start.getMonth() - 2);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'year':
      start.setMonth(start.getMonth() - 11);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case '6months':
    default:
      start.setMonth(start.getMonth() - 5);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return { start, end, period: period || '6months' };
};

const previousMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { start, end };
};

const currentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end: now };
};

const commissionFrom = (revenue, rate) => round((revenue * rate) / 100);

const DAILY_BUCKET_LABELS = ['00h', '04h', '08h', '12h', '16h', '20h'];

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const startOfIsoWeek = (date) => {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
};

const endOfIsoWeek = (date) => {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return endOfDay(end);
};

const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatMonthKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const resolvePeriodReportRange = (period, dateFrom, dateTo) => {
  if (dateFrom && dateTo) {
    return {
      start: startOfDay(new Date(dateFrom)),
      end: endOfDay(new Date(dateTo)),
      period,
    };
  }

  const end = new Date();
  let start;

  switch (period) {
    case 'weekly':
      start = startOfIsoWeek(end);
      break;
    case 'monthly':
      start = new Date(end);
      start.setMonth(start.getMonth() - 5);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'daily':
    default:
      start = startOfDay(end);
      break;
  }

  return { start, end, period: period || 'daily' };
};

const resolvePreviousPeriodRange = (period, start, end) => {
  const durationMs = end.getTime() - start.getTime();

  if (period === 'weekly') {
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = startOfIsoWeek(prevEnd);
    return { start: prevStart, end: endOfDay(prevEnd) };
  }

  if (period === 'monthly') {
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setMonth(prevStart.getMonth() - 5);
    prevStart.setDate(1);
    prevStart.setHours(0, 0, 0, 0);
    return { start: prevStart, end: prevEnd };
  }

  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
};

const buildDailyBuckets = () =>
  DAILY_BUCKET_LABELS.map((name, i) => ({ key: String(i), name }));

const buildWeeklyBuckets = (start, end) => {
  const buckets = [];
  const cursor = startOfIsoWeek(start);
  const weekEnd = endOfIsoWeek(end);

  for (let i = 0; i < 7; i++) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + i);
    if (day > weekEnd) break;
    buckets.push({
      key: formatDateKey(day),
      name: day.toLocaleString('en-US', { weekday: 'short', timeZone: DASHBOARD_TZ }),
    });
  }
  return buckets;
};

const buildMonthlyBuckets = (start, end) => {
  const buckets = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    buckets.push({
      key: formatMonthKey(cursor),
      name: cursor.toLocaleString('en-US', { month: 'short', timeZone: DASHBOARD_TZ }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return buckets;
};

const chartTitleForPeriod = (period) => {
  const titles = {
    daily: 'Hourly Revenue (Today)',
    weekly: 'Daily Revenue (This Week)',
    monthly: 'Monthly Revenue (This Year)',
  };
  return titles[period] || titles.daily;
};

const buildChartData = (buckets, earningsMap, commissionRate) =>
  buckets.map(({ key, name }) => {
    const revenue = round(earningsMap.get(key) || 0);
    return {
      name,
      revenue,
      commission: commissionFrom(revenue, commissionRate),
    };
  });

class AgentAnalyticsService {
  async bumpCache(agentId) {
    await bumpCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
  }

  async getRevenueSummary(agentId, query = {}) {
    const period = query.period || '6months';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:revenue:summary:v${version}:${agentId}:${period}:${query.dateFrom || ''}:${query.dateTo || ''}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const listenerIds = await agentAnalyticsRepository.getListenerIdsForAgent(agentId);
    const { start, end } = resolveRevenueRange(period, query.dateFrom, query.dateTo);
    const prevMonth = previousMonthRange();
    const curMonth = currentMonthRange();

    const [periodEarn, prevMonthEarn, curMonthEarn, activeCount, spark] = await Promise.all([
      agentAnalyticsRepository.sumEarningsInRange(listenerIds, start, end),
      agentAnalyticsRepository.sumEarningsInRange(listenerIds, prevMonth.start, prevMonth.end),
      agentAnalyticsRepository.sumEarningsInRange(listenerIds, curMonth.start, curMonth.end),
      agentAnalyticsRepository.countActiveListenersInRange(listenerIds, start, end),
      agentAnalyticsRepository.getMonthlyEarningsSpark(listenerIds, 10),
    ]);

    const totalRevenue = periodEarn.total;
    const avgPerListener = activeCount ? round(totalRevenue / activeCount) : 0;
    const topSource = periodEarn.giftCoins >= periodEarn.sessionCoins ? 'Gifts' : 'Calls';
    const momGrowthPct = calcTrend(curMonthEarn.total, prevMonthEarn.total);

    const payload = {
      period,
      cards: [
        {
          label: 'Total Revenue',
          value: round(totalRevenue),
          trend: calcTrend(totalRevenue, prevMonthEarn.total),
          positive: totalRevenue >= prevMonthEarn.total,
          spark,
        },
        {
          label: 'Avg/Listener',
          value: avgPerListener,
          trend: calcTrend(avgPerListener, prevMonthEarn.total / Math.max(activeCount, 1)),
          positive: avgPerListener >= prevMonthEarn.total / Math.max(activeCount, 1),
          spark: spark.map((v) => Math.round(v / Math.max(activeCount, 1))),
        },
        {
          label: 'Top Source',
          value: topSource,
          trend: periodEarn.giftCoins >= periodEarn.sessionCoins ? periodEarn.giftCoins : periodEarn.sessionCoins,
          positive: true,
          spark: [periodEarn.giftCoins, periodEarn.sessionCoins],
        },
        {
          label: 'MoM Growth',
          value: momGrowthPct,
          trend: momGrowthPct,
          positive: momGrowthPct >= 0,
          spark,
        },
      ],
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getRevenueCharts(agentId, query = {}) {
    const period = query.period || '6months';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:revenue:charts:v${version}:${agentId}:${period}:${query.dateFrom || ''}:${query.dateTo || ''}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const listenerIds = await agentAnalyticsRepository.getListenerIdsForAgent(agentId);
    const { start, end } = resolveRevenueRange(period, query.dateFrom, query.dateTo);

    const earnings = await agentAnalyticsRepository.sumEarningsInRange(listenerIds, start, end);
    const total = earnings.total || 1;

    const chartData = [
      { name: 'Gifts', value: round(earnings.giftCoins) },
      { name: 'Calls', value: round(earnings.sessionCoins) },
    ].filter((row) => row.value > 0);

    const breakdown = [
      { label: 'Gifts', value: round(earnings.giftCoins), pct: round((earnings.giftCoins / total) * 100) },
      { label: 'Calls', value: round(earnings.sessionCoins), pct: round((earnings.sessionCoins / total) * 100) },
    ].filter((row) => row.value > 0);

    const payload = {
      period,
      chartTitle: 'Revenue by Source',
      chartType: 'bar',
      chartData: chartData.length ? chartData : [{ name: 'Gifts', value: 0 }, { name: 'Calls', value: 0 }],
      breakdown: breakdown.length
        ? breakdown
        : [
            { label: 'Gifts', value: 0, pct: 0 },
            { label: 'Calls', value: 0, pct: 0 },
          ],
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getListenersSummary(agentId, query = {}) {
    const period = query.period || '6months';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:listeners:summary:v${version}:${agentId}:${period}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const summary = await agentAnalyticsRepository.getListenerSummary(agentId);

    const payload = {
      period,
      cards: [
        {
          label: 'Total Listeners',
          value: summary.totalListeners,
          trend: summary.totalListeners,
          positive: true,
          spark: await this._listenerCountSpark(agentId, listenerPeriodToMonths(period)),
        },
        {
          label: 'Avg. Level',
          value: round(summary.avgLevel * 10) / 10,
          trend: round(summary.avgLevel * 10) / 10,
          positive: true,
          spark: [],
        },
        {
          label: 'Active Rate',
          value: round(summary.activeRatePct * 10) / 10,
          trend: round(summary.activeRatePct * 10) / 10,
          positive: summary.activeRatePct >= 50,
          spark: [],
        },
        {
          label: 'Churned',
          value: round(summary.churnRatePct * 10) / 10,
          trend: round(summary.churnRatePct * 10) / 10,
          positive: false,
          spark: [],
        },
      ],
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getListenersCharts(agentId, query = {}) {
    const period = query.period || '6months';
    const months = listenerPeriodToMonths(period);
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:listeners:charts:v${version}:${agentId}:${period}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const chartData = await agentAnalyticsRepository.getListenerGrowthSeries(agentId, months);

    const payload = {
      period,
      chartTitle: 'Listener Growth',
      chartType: 'line',
      chartData,
      seriesLabels: { value: 'Total', value2: 'Active' },
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getRetentionSummary(agentId, query = {}) {
    const cohortMonths = Number(query.cohortMonths) || 6;
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:retention:summary:v${version}:${agentId}:${cohortMonths}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const stats = await agentAnalyticsRepository.getRetentionSummary(agentId);

    const payload = {
      cohortMonths,
      cards: [
        {
          label: '30-day Retention',
          value: stats.retention30Pct,
          trend: stats.retention30Pct,
          positive: stats.retention30Pct >= 50,
          spark: [],
        },
        {
          label: '90-day Retention',
          value: stats.retention90Pct,
          trend: stats.retention90Pct,
          positive: stats.retention90Pct >= 50,
          spark: [],
        },
        {
          label: 'Repeat Rate',
          value: stats.repeatRatePct,
          trend: stats.repeatRatePct,
          positive: stats.repeatRatePct >= 40,
          spark: [],
        },
        {
          label: 'Churn',
          value: stats.churnRatePct,
          trend: stats.churnRatePct,
          positive: false,
          spark: [],
        },
      ],
    };

    await setCache(cacheKey, payload, RETENTION_CACHE_TTL);
    return payload;
  }

  async getRetentionCharts(agentId, query = {}) {
    const cohortMonths = Number(query.cohortMonths) || 6;
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:retention:charts:v${version}:${agentId}:${cohortMonths}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const chartData = await agentAnalyticsRepository.getRetentionCurve(agentId, cohortMonths);

    const payload = {
      cohortMonths,
      chartTitle: 'Retention Curve',
      chartType: 'area',
      chartData,
    };

    await setCache(cacheKey, payload, RETENTION_CACHE_TTL);
    return payload;
  }

  async getPeriodReport(agentId, query = {}) {
    const period = query.period || 'daily';
    const version = await getCacheVersion(`${CACHE_NS_PREFIX}:${agentId}`);
    const cacheKey = `${CACHE_NS_PREFIX}:period-report:v${version}:${agentId}:${period}:${query.dateFrom || ''}:${query.dateTo || ''}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { start, end } = resolvePeriodReportRange(period, query.dateFrom, query.dateTo);
    const prevRange = resolvePreviousPeriodRange(period, start, end);

    const [listenerIds, commissionRate] = await Promise.all([
      agentAnalyticsRepository.getListenerIdsForAgent(agentId),
      agentRepository.getAgentCommissionRate(agentId),
    ]);

    const [earningsMap, newListeners, activeListeners, prevNewListeners] = await Promise.all([
      agentAnalyticsRepository.getEarningsSeries(listenerIds, start, end, period),
      agentAnalyticsRepository.countNewListeners(agentId, start, end),
      agentAnalyticsRepository.countActiveListenersInRange(listenerIds, start, end),
      agentAnalyticsRepository.countNewListeners(agentId, prevRange.start, prevRange.end),
    ]);

    const buckets =
      period === 'weekly'
        ? buildWeeklyBuckets(start, end)
        : period === 'monthly'
          ? buildMonthlyBuckets(start, end)
          : buildDailyBuckets();

    const chartData = buildChartData(buckets, earningsMap, commissionRate);
    const totalRevenue = round(chartData.reduce((sum, row) => sum + row.revenue, 0));
    const totalCommission = round(chartData.reduce((sum, row) => sum + row.commission, 0));
    const growthPct = calcTrend(newListeners, prevNewListeners);

    const stats =
      period === 'daily'
        ? [
            { label: 'Revenue', value: totalRevenue },
            { label: 'New Listeners', value: newListeners },
            { label: 'Active Listeners', value: activeListeners },
            { label: 'Commission', value: totalCommission },
          ]
        : [
            { label: 'Revenue', value: totalRevenue },
            { label: 'New Listeners', value: newListeners },
            { label: 'Growth', value: growthPct },
            { label: 'Commission', value: totalCommission },
          ];

    const payload = {
      period,
      chartTitle: chartTitleForPeriod(period),
      stats,
      chartData,
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async _listenerCountSpark(agentId, months) {
    const series = await agentAnalyticsRepository.getListenerGrowthSeries(agentId, months);
    return series.map((row) => row.value);
  }
}

export default new AgentAnalyticsService();
