/**
 * Date / time-period utilities for dashboards and analytics.
 * Periods are computed relative to "now"; aggregations group on `createdAt`.
 */

// Timezone used for "start of day" boundaries and chart bucketing.
// Override via env TIMEZONE (e.g. 'UTC', 'America/New_York').
export const DASHBOARD_TZ = process.env.TIMEZONE || 'Asia/Kolkata';

export const PERIODS = ['today', 'week', 'month'];

/**
 * Resolve a period keyword into a concrete { start, end } date range.
 *   today → start of the current day (TZ-aware) → now
 *   week  → 7 days ago (start of that day) → now
 *   month → 30 days ago (start of that day) → now
 */
export const getPeriodRange = (period = 'today') => {
  const end = new Date();

  // Compute the local (TZ-aware) calendar date for "now".
  const localNow = new Date(end.toLocaleString('en-US', { timeZone: DASHBOARD_TZ }));
  const startLocal = new Date(localNow);
  startLocal.setHours(0, 0, 0, 0);

  if (period === 'week') {
    startLocal.setDate(startLocal.getDate() - 6); // include today → 7-day window
  } else if (period === 'month') {
    startLocal.setDate(startLocal.getDate() - 29); // include today → 30-day window
  }

  // Re-anchor the TZ-local midnight back to a real UTC instant.
  const tzOffsetMs = localNow.getTime() - end.getTime();
  const start = new Date(startLocal.getTime() - tzOffsetMs);

  return { start, end };
};

/**
 * Bucket granularity for a period's growth chart.
 *   today → hourly  (00..23)
 *   week  → daily   (last 7 days)
 *   month → daily   (last 30 days)
 * `format` is a Mongo $dateToString format string; `unit`/`count` drive the
 * JS-side gap-filling so the series is continuous even with no data.
 */
export const getChartGrouping = (period = 'today') => {
  if (period === 'today') {
    return { unit: 'hour', count: 24, format: '%H' };
  }
  if (period === 'week') {
    return { unit: 'day', count: 7, format: '%Y-%m-%d' };
  }
  return { unit: 'day', count: 30, format: '%Y-%m-%d' };
};

/**
 * Build a continuous, zero-filled series of bucket keys for a period, then
 * overlay aggregated values keyed by the same bucket label.
 * `rows` = [{ _id: '<bucketLabel>', value: <number> }]
 * Returns [{ name, earnings }] in chronological order.
 */
export const buildSeries = (period, rows = []) => {
  const { unit, count } = getChartGrouping(period);
  const valueByKey = new Map(rows.map((r) => [String(r._id), r.value || 0]));

  const series = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: DASHBOARD_TZ }));

  if (unit === 'hour') {
    for (let h = 0; h < count; h++) {
      const key = String(h).padStart(2, '0');
      series.push({ name: `${key}:00`, earnings: valueByKey.get(key) || 0 });
    }
  } else {
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (count - 1));
    for (let i = 0; i < count; i++) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;
      series.push({ name: `${m}-${d}`, earnings: valueByKey.get(key) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return series;
};
