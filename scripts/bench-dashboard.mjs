const BASE = process.env.API_BASE || 'http://localhost:5000/api/v1';
const TOKEN = process.env.ADMIN_TOKEN || '';

const endpoints = [
  '/admin/dashboard/summary?year=2026&month=7',
  '/admin/dashboard/charts?year=2026&month=7',
  '/admin/dashboard/listeners/busy?page=1&limit=20',
  '/admin/dashboard/sessions/chat?page=1&limit=20',
];

const TARGET_MS = 200;

async function hit(path, bust) {
  const url = `${BASE}${path}${bust ? `&_bust=${Date.now()}${Math.random()}` : ''}`;
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const t0 = performance.now();
  const res = await fetch(url, { headers });
  const ms = Math.round(performance.now() - t0);
  const label = path.split('?')[0].split('/').slice(-1)[0];
  return { label, ms, status: res.status, ok: res.ok };
}

if (!TOKEN) {
  console.warn('Set ADMIN_TOKEN env var for authenticated bench runs.');
}

console.log('=== COLD (unique query params) ===');
for (const e of endpoints) {
  const r = await hit(e.replace('month=7', `month=7&_c=${Date.now()}`), true);
  console.log(`${r.label.padEnd(14)} ${String(r.ms).padStart(4)}ms  ${r.status}`);
}

console.log('\n=== WARM (repeat same params) ===');
const warm = [];
for (const e of endpoints) {
  const r = await hit(e, false);
  warm.push(r.ms);
  const flag = r.ms <= TARGET_MS ? 'OK' : 'SLOW';
  console.log(`${r.label.padEnd(14)} ${String(r.ms).padStart(4)}ms  ${r.status}  ${flag}`);
}

const p95 = warm.sort((a, b) => a - b)[Math.ceil(warm.length * 0.95) - 1] ?? 0;
console.log(`\nWarm p95: ${p95}ms (target <= ${TARGET_MS}ms)`);
process.exit(p95 <= TARGET_MS ? 0 : 1);
