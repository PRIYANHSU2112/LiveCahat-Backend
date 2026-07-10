import adminAnalyticsRepository from '../repositories/admin-analytics.repository.js';
import { resolveAdminAnalyticsRange } from '../utils/date-filter.util.js';
import { getCache, setCache } from '../utils/redis.util.js';

const CACHE_NS = 'admin:analytics';
/** Single TTL for full page payload — avoids constant cold hits from short summary TTL. */
const PAGE_TTL = 120;

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const calcTrend = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return round(((current - previous) / previous) * 100);
};

const buildCard = (label, value, previousValue, options = {}) => {
  const changePct = calcTrend(value, previousValue);
  const increased = value >= previousValue;
  const positive = options.invertPositive ? !increased : increased;
  return {
    label,
    value: round(value),
    previousValue: round(previousValue),
    changePct,
    positive,
  };
};

const formatDuration = (seconds) => {
  const s = Math.round(seconds || 0);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return { display: `${m}m ${rem}s`, seconds: s };
};

const cacheKey = (domain, query) => {
  const q = JSON.stringify({
    year: query.year ?? '',
    month: query.month ?? '',
    day: query.day ?? '',
    dateFrom: query.dateFrom ?? '',
    dateTo: query.dateTo ?? '',
  });
  return `${CACHE_NS}:${domain}:page:${q}`;
};

class AdminAnalyticsService {
  async _loadPage(domain, query, buildSummary, buildCharts) {
    const key = cacheKey(domain, query);
    const cached = await getCache(key);
    if (cached) return cached;

    const range = resolveAdminAnalyticsRange(query);
    const [summary, charts] = await Promise.all([buildSummary(range), buildCharts(range)]);
    const payload = { summary, charts };
    await setCache(key, payload, PAGE_TTL);
    return payload;
  }

  async _revenueSummary(range) {
    const { current, previous } = await adminAnalyticsRepository.getRevenuePeriodTotals(
      range.start,
      range.end,
      range.previousStart,
      range.previousEnd
    );

    const takeRate = current.grossCoinVolume
      ? round((current.platformRevenue / current.grossCoinVolume) * 100)
      : 0;
    const prevTakeRate = previous.grossCoinVolume
      ? round((previous.platformRevenue / previous.grossCoinVolume) * 100)
      : 0;

    return {
      range: { start: range.start, end: range.end, label: range.label },
      comparisonLabel: 'vs previous period',
      cards: [
        buildCard('Platform Revenue (Coins)', current.platformRevenue, previous.platformRevenue),
        buildCard('Gross Coin Volume', current.grossCoinVolume, previous.grossCoinVolume),
        buildCard('Coin Top-ups (INR)', current.topUpInr, previous.topUpInr),
        buildCard('Platform Take Rate', takeRate, prevTakeRate),
      ],
    };
  }

  async _revenueCharts(range) {
    const { chartData, breakdown } = await adminAnalyticsRepository.getRevenueChartSeries(
      range.start,
      range.end,
      range.granularity
    );

    return {
      chartTitle: 'Platform Revenue Over Time',
      chartType: 'area',
      chartData: chartData.map((d) => ({ name: d.name, value: d.value })),
      breakdown,
      seriesLabels: { value: 'Revenue (Coins)' },
    };
  }

  async getRevenueAnalytics(query = {}) {
    return this._loadPage('revenue', query, (r) => this._revenueSummary(r), (r) => this._revenueCharts(r));
  }

  async getRevenueSummary(query = {}) {
    const { summary } = await this.getRevenueAnalytics(query);
    return summary;
  }

  async getRevenueCharts(query = {}) {
    const { charts } = await this.getRevenueAnalytics(query);
    return charts;
  }

  async _usersSummary(range) {
    const { current, previous } = await adminAnalyticsRepository.getUserPeriodTotals(
      range.start,
      range.end,
      range.previousStart,
      range.previousEnd
    );

    return {
      range: { start: range.start, end: range.end, label: range.label },
      comparisonLabel: 'vs previous period',
      cards: [
        buildCard('Total Users', current.totalUsers, previous.totalUsers),
        buildCard('Active Users', current.activeUsers, previous.activeUsers),
        buildCard('New Sign-ups', current.newSignups, previous.newSignups),
        buildCard('Inactive Users (30d+)', current.inactiveUsers, previous.inactiveUsers, {
          invertPositive: true,
        }),
      ],
    };
  }

  async _usersCharts(range) {
    const chartData = await adminAnalyticsRepository.getUserChartSeries(
      range.start,
      range.end,
      range.granularity
    );

    return {
      chartTitle: 'User Growth',
      chartType: 'line',
      chartData,
      seriesLabels: { value: 'New Sign-ups', value2: 'Active (Sessions)' },
    };
  }

  async getUsersAnalytics(query = {}) {
    return this._loadPage('users', query, (r) => this._usersSummary(r), (r) => this._usersCharts(r));
  }

  async getUsersSummary(query = {}) {
    const { summary } = await this.getUsersAnalytics(query);
    return summary;
  }

  async getUsersCharts(query = {}) {
    const { charts } = await this.getUsersAnalytics(query);
    return charts;
  }

  async _listenersSummary(range) {
    const { current, previous } = await adminAnalyticsRepository.getListenerPeriodTotals(
      range.start,
      range.end,
      range.previousStart,
      range.previousEnd
    );

    return {
      range: { start: range.start, end: range.end, label: range.label },
      comparisonLabel: 'vs previous period',
      cards: [
        buildCard('Approved Listeners', current.approvedListeners, previous.approvedListeners),
        buildCard('Active Listeners', current.activeListeners, previous.activeListeners),
        buildCard('Avg Sessions per Day', current.avgSessionsPerDay, previous.avgSessionsPerDay),
        buildCard('New Listeners', current.newListeners, previous.newListeners),
      ],
    };
  }

  async _listenersCharts(range) {
    const chartData = await adminAnalyticsRepository.getListenerChartSeries(
      range.start,
      range.end,
      range.granularity
    );

    return {
      chartTitle: 'Listener Session Activity',
      chartType: 'bar',
      chartData,
      seriesLabels: { value: 'Sessions' },
    };
  }

  async getListenersAnalytics(query = {}) {
    return this._loadPage('listeners', query, (r) => this._listenersSummary(r), (r) => this._listenersCharts(r));
  }

  async getListenersSummary(query = {}) {
    const { summary } = await this.getListenersAnalytics(query);
    return summary;
  }

  async getListenersCharts(query = {}) {
    const { charts } = await this.getListenersAnalytics(query);
    return charts;
  }

  async _sessionsSummary(range) {
    const { current, previous } = await adminAnalyticsRepository.getSessionPeriodTotals(
      range.start,
      range.end,
      range.previousStart,
      range.previousEnd
    );

    const curDur = formatDuration(current.avgDurationSeconds);
    const prevDur = formatDuration(previous.avgDurationSeconds);

    return {
      range: { start: range.start, end: range.end, label: range.label },
      comparisonLabel: 'vs previous period',
      cards: [
        buildCard('Completed Sessions', current.completedSessions, previous.completedSessions),
        {
          ...buildCard('Avg Duration', curDur.seconds, prevDur.seconds),
          displayValue: curDur.display,
          previousDisplayValue: prevDur.display,
        },
        buildCard('Completion Rate', current.completionRate, previous.completionRate),
        {
          ...buildCard('Peak Hour Volume', current.peakHourCount, previous.peakHourCount),
          displayValue: current.peakHour ?? '—',
          previousDisplayValue: previous.peakHour ?? '—',
          label: 'Peak Hour',
        },
      ],
    };
  }

  async _sessionsCharts(range) {
    const { chartData, breakdown } = await adminAnalyticsRepository.getSessionChartSeries(
      range.start,
      range.end,
      range.granularity
    );

    return {
      chartTitle: 'Session Volume',
      chartType: 'bar',
      chartData,
      breakdown,
      seriesLabels: { value: 'Sessions' },
    };
  }

  async getSessionsAnalytics(query = {}) {
    return this._loadPage('sessions', query, (r) => this._sessionsSummary(r), (r) => this._sessionsCharts(r));
  }

  async getSessionsSummary(query = {}) {
    const { summary } = await this.getSessionsAnalytics(query);
    return summary;
  }

  async getSessionsCharts(query = {}) {
    const { charts } = await this.getSessionsAnalytics(query);
    return charts;
  }
}

export default new AdminAnalyticsService();
