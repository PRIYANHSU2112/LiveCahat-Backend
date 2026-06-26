/**
 * Helpers for KPI stat cards: period boundaries, daily peak date keys, and
 * count/percentage/trend comparison objects.
 */

/**
 * Format a Date as a YYYY-MM-DD key in server local time. Used for the
 * per-agent daily peak Redis keys so "today" and "yesterday" line up with the
 * month/day boundaries computed by getDateBoundaries().
 *
 * @param {Date} date
 * @returns {String}
 */
export const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Compute the period boundaries used by the agent stat cards (server local time).
 *
 * @returns {{ now: Date, startOfToday: Date, startOfYesterday: Date, startOfThisMonth: Date, startOfLastMonth: Date }}
 */
export const getDateBoundaries = () => {
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  return { now, startOfToday, startOfYesterday, startOfThisMonth, startOfLastMonth };
};

/**
 * Build a comparison stat card: current count plus the percentage change and
 * trend relative to a previous period.
 *
 * Per spec: when there is no previous-period data (previous === 0), report 0%
 * and a "no_change" trend regardless of the current value.
 *
 * @param {Number} current
 * @param {Number} previous
 * @returns {{ count: Number, percentageChange: Number, trend: 'increase'|'decrease'|'no_change' }}
 */
export const buildComparison = (current, previous) => {
  const cur = current || 0;
  const prev = previous || 0;

  if (prev === 0) {
    return { count: cur, percentageChange: 0, trend: 'no_change' };
  }

  const percentageChange = Math.round(((cur - prev) / prev) * 100);
  let trend = 'no_change';
  if (cur > prev) trend = 'increase';
  else if (cur < prev) trend = 'decrease';

  return { count: cur, percentageChange, trend };
};
