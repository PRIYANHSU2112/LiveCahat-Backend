import adminAnalyticsRepository from '../repositories/admin-analytics.repository.js';
import adminDashboardRepository from '../repositories/admin-dashboard.repository.js';
import adminAnalyticsService from './admin-analytics.service.js';
import { resolveAdminAnalyticsRange } from '../utils/date-filter.util.js';
import { getCache, setCache } from '../utils/redis.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

const CACHE_NS = 'admin:dashboard';
const SUMMARY_TTL = 60;
const CHARTS_TTL = 120;
const LIST_TTL = 15;

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const calcTrend = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return round(((current - previous) / previous) * 100);
};

const buildCard = (key, label, value, previousValue, options = {}) => {
  const changePct = calcTrend(value, previousValue);
  const increased = value >= previousValue;
  const positive = options.invertPositive ? !increased : increased;
  return {
    key,
    label,
    value: round(value),
    previousValue: round(previousValue),
    changePct,
    positive,
    ...(options.displayValue != null ? { displayValue: options.displayValue } : {}),
    ...(options.previousDisplayValue != null
      ? { previousDisplayValue: options.previousDisplayValue }
      : {}),
  };
};

const cacheKey = (section, query) => {
  const q = JSON.stringify({
    year: query.year ?? '',
    month: query.month ?? '',
    day: query.day ?? '',
    dateFrom: query.dateFrom ?? '',
    dateTo: query.dateTo ?? '',
    page: query.page ?? '',
    limit: query.limit ?? '',
    search: query.search ?? '',
  });
  return `${CACHE_NS}:${section}:${q}`;
};

const formatInr = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);

class AdminDashboardService {
  async getSummary(query = {}) {
    const key = cacheKey('summary', query);
    const cached = await getCache(key);
    const pulse = await adminDashboardRepository.getPulseCounts();

    if (cached) {
      return { ...cached, pulse };
    }

    const range = resolveAdminAnalyticsRange(query);

    const [
      revenueTotals,
      userTotals,
      sessionTotals,
      pendingTotals,
      modeTotals,
    ] = await Promise.all([
      adminAnalyticsRepository.getRevenuePeriodTotals(
        range.start,
        range.end,
        range.previousStart,
        range.previousEnd
      ),
      adminAnalyticsRepository.getUserPeriodTotals(
        range.start,
        range.end,
        range.previousStart,
        range.previousEnd
      ),
      adminAnalyticsRepository.getSessionPeriodTotals(
        range.start,
        range.end,
        range.previousStart,
        range.previousEnd
      ),
      adminDashboardRepository.getPendingPeriodTotals(
        range.start,
        range.end,
        range.previousStart,
        range.previousEnd
      ),
      adminDashboardRepository.getCompletedSessionsByMode(
        range.start,
        range.end,
        range.previousStart,
        range.previousEnd
      ),
    ]);

    const { current: rev, previous: prevRev } = revenueTotals;
    const { current: users, previous: prevUsers } = userTotals;
    const { current: sessions, previous: prevSessions } = sessionTotals;

    const payload = {
      range: { start: range.start, end: range.end, label: range.label },
      comparisonLabel: 'vs previous period',
      cards: [
        buildCard(
          'platformRevenue',
          'Total Revenue (Coins)',
          rev.platformRevenue,
          prevRev.platformRevenue
        ),
        buildCard('coinTopUps', 'Coin Top-ups (INR)', rev.topUpInr, prevRev.topUpInr),
        buildCard('activeUsers', 'Active Users', users.activeUsers, prevUsers.activeUsers),
        buildCard(
          'completedSessions',
          'Completed Sessions',
          sessions.completedSessions,
          prevSessions.completedSessions
        ),
        buildCard(
          'completedChatSessions',
          'Completed Chat Sessions',
          modeTotals.current.CHAT,
          modeTotals.previous.CHAT
        ),
        buildCard(
          'completedVoiceSessions',
          'Completed Voice Sessions',
          modeTotals.current.AUDIO,
          modeTotals.previous.AUDIO
        ),
        buildCard(
          'completedVideoSessions',
          'Completed Video Sessions',
          modeTotals.current.VIDEO,
          modeTotals.previous.VIDEO
        ),
        buildCard(
          'pendingApprovals',
          'Pending Approvals',
          pendingTotals.kycPendingCurrent,
          pendingTotals.kycPendingPrevious,
          { invertPositive: true }
        ),
        buildCard(
          'pendingWithdrawals',
          'Pending Withdrawals (INR)',
          pendingTotals.withdrawalPendingInr,
          pendingTotals.withdrawalNewPendingPreviousInr,
          {
            invertPositive: true,
            displayValue: formatInr(pendingTotals.withdrawalPendingInr),
            previousDisplayValue: formatInr(pendingTotals.withdrawalNewPendingPreviousInr),
          }
        ),
      ],
      pulse,
    };

    const { pulse: _pulse, ...cachePayload } = payload;
    await setCache(key, cachePayload, SUMMARY_TTL);
    return payload;
  }

  async getCharts(query = {}) {
    const key = cacheKey('charts', query);
    const cached = await getCache(key);
    if (cached) return cached;

    const range = resolveAdminAnalyticsRange(query);

    const [revenueCharts, userCharts, sessionCharts, peakHours] = await Promise.all([
      adminAnalyticsService.getRevenueCharts(query),
      adminAnalyticsService.getUsersCharts(query),
      adminAnalyticsService.getSessionsCharts(query),
      adminDashboardRepository.getPeakHoursSeries(range.start, range.end),
    ]);

    const revenueChartData = (revenueCharts.chartData ?? []).map((d) => ({
      name: d.name,
      revenue: d.value,
      coins: d.value,
    }));

    const registrationsChartData = (userCharts.chartData ?? []).map((d) => ({
      name: d.name,
      registrations: d.value,
      active: d.value2 ?? 0,
    }));

    const channelSplit = (sessionCharts.breakdown ?? []).map((row, i) => ({
      name: row.label,
      value: row.pct,
      color: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'][i % 3],
    }));

    const payload = {
      range: { start: range.start, end: range.end, label: range.label },
      revenue: {
        title: revenueCharts.chartTitle,
        data: revenueChartData,
      },
      registrations: {
        title: userCharts.chartTitle,
        data: registrationsChartData,
      },
      sessions: {
        title: sessionCharts.chartTitle,
        data: sessionCharts.chartData ?? [],
        breakdown: sessionCharts.breakdown ?? [],
      },
      channelSplit,
      peakHours: {
        title: 'Peak Usage Hours',
        data: peakHours,
      },
    };

    await setCache(key, payload, CHARTS_TTL);
    return payload;
  }

  async getBusyListeners(query = {}) {
    const key = cacheKey('busy-listeners', query);
    const cached = await getCache(key);
    if (cached) return cached;

    const { page, limit, skip } = getPaginationOptions(query);
    const { total, data } = await adminDashboardRepository.getBusyListeners({
      search: query.search,
      skip,
      limit,
    });

    const payload = formatPaginatedResponse(data, total, page, limit);
    await setCache(key, payload, LIST_TTL);
    return payload;
  }

  async getChatSessions(query = {}) {
    const key = cacheKey('chat-sessions', query);
    const cached = await getCache(key);
    if (cached) return cached;

    const { page, limit, skip } = getPaginationOptions(query);
    const { total, data } = await adminDashboardRepository.getChatSessions({
      search: query.search,
      skip,
      limit,
    });

    const payload = formatPaginatedResponse(data, total, page, limit);
    await setCache(key, payload, LIST_TTL);
    return payload;
  }
}

export default new AdminDashboardService();
