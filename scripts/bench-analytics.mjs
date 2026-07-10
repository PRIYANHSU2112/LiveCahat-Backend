const BASE = process.env.API_BASE || 'http://localhost:5000/api';
const TOKEN = process.env.ADMIN_TOKEN || 'mock-jwt-token';

const endpoints = [
  '/analytics/admin/revenue?year=2026&month=7',
  '/analytics/admin/users?year=2026&month=7',
  '/analytics/admin/listeners?year=2026&month=7',
  '/analytics/admin/sessions?year=2026&month=7',
];

async function hit(path, bust) {
  const url = `${BASE}${path}${bust ? `&_bust=${Date.now()}${Math.random()}` : ''}`;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const ms = Math.round(performance.now() - t0);
  const label = path.split('?')[0].split('/').slice(-1)[0];
  return { label, ms, status: res.status };
}

console.log('=== COLD (unique query params) ===');
for (const e of endpoints) {
  const r = await hit(e.replace('month=7', `month=7&_c=${Date.now()}`), true);
  console.log(`${r.label.padEnd(12)} ${String(r.ms).padStart(4)}ms  ${r.status}`);
}

console.log('\n=== WARM (repeat same params) ===');
for (const e of endpoints) {
  const r = await hit(e, false);
  console.log(`${r.label.padEnd(12)} ${String(r.ms).padStart(4)}ms  ${r.status}`);
}
