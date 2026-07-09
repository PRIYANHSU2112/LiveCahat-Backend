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
