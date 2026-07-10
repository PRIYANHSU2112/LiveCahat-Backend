/**
 * Build a MongoDB filter on `createdAt` using UTC date boundaries.
 * @param {{ year?: number|string, month?: number|string, day?: number|string }} params
 * @returns {{ createdAt?: { $gte: Date, $lt: Date } }}
 */
export function buildUtcCreatedAtFilter({ year, month, day } = {}) {
  if (year == null || year === '') return {};

  const y = parseInt(year, 10);
  if (Number.isNaN(y)) return {};

  if (month != null && month !== '' && day != null && day !== '') {
    const m = parseInt(month, 10) - 1;
    const d = parseInt(day, 10);
    const start = new Date(Date.UTC(y, m, d));
    const end = new Date(Date.UTC(y, m, d + 1));
    return { createdAt: { $gte: start, $lt: end } };
  }

  if (month != null && month !== '') {
    const m = parseInt(month, 10) - 1;
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 1));
    return { createdAt: { $gte: start, $lt: end } };
  }

  const start = new Date(Date.UTC(y, 0, 1));
  const end = new Date(Date.UTC(y + 1, 0, 1));
  return { createdAt: { $gte: start, $lt: end } };
}

/**
 * UTC start/end of today for pulse metrics.
 */
export function getUtcTodayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

const endOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/**
 * Inclusive UTC end instant for preset filters (end of last day in range).
 */
export function resolveUtcRangeBounds({ year, month, day } = {}) {
  const filter = buildUtcCreatedAtFilter({ year, month, day });
  if (!filter.createdAt) return null;

  const start = filter.createdAt.$gte;
  const endExclusive = filter.createdAt.$lt;
  const end = new Date(endExclusive.getTime() - 1);

  return { start, end };
}

/**
 * Default range: current calendar month (UTC).
 */
export function getDefaultAnalyticsMonthRange() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = endOfUtcDay(now);
  return { start, end };
}

/**
 * Previous period of equal duration immediately before `start`.
 * @param {Date} start
 * @param {Date} end
 */
export function resolvePreviousAnalyticsRange(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);
  return { previousStart, previousEnd };
}

/**
 * Chart bucket granularity from range span.
 * @returns {'hourly'|'daily'|'weekly'|'monthly'}
 */
export function resolveChartGranularity(start, end) {
  const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000) + 1;
  if (days <= 1.5) return 'hourly';
  if (days <= 31) return 'daily';
  if (days <= 90) return 'weekly';
  return 'monthly';
}

/**
 * Human-readable label for the selected analytics range.
 */
export function formatAnalyticsRangeLabel(start, end, query = {}) {
  const { year, month, day } = query;
  if (year && month && day) {
    const d = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  if (year && month) {
    const d = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, 1));
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  if (year) return String(year);
  return `${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)}`;
}

/**
 * Resolve admin analytics date range from query params.
 * Custom dateFrom/dateTo takes priority; else year/month/day; else current month.
 *
 * @param {{ year?: number|string, month?: number|string, day?: number|string, dateFrom?: string|Date, dateTo?: string|Date }} query
 */
export function resolveAdminAnalyticsRange(query = {}) {
  let start;
  let end;

  if (query.dateFrom && query.dateTo) {
    start = new Date(query.dateFrom);
    end = endOfUtcDay(new Date(query.dateTo));
  } else {
    const preset = resolveUtcRangeBounds(query);
    if (preset) {
      ({ start, end } = preset);
    } else {
      ({ start, end } = getDefaultAnalyticsMonthRange());
    }
  }

  const { previousStart, previousEnd } = resolvePreviousAnalyticsRange(start, end);
  const granularity = resolveChartGranularity(start, end);

  return {
    start,
    end,
    previousStart,
    previousEnd,
    granularity,
    label: formatAnalyticsRangeLabel(start, end, query),
  };
}
