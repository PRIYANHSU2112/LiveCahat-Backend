/**
 * Performance test for CUSTOMER & LISTENER APIs (target: < 200ms)
 */
const BASE = 'http://localhost:5000/api/v1';

const customerMobile = `9${String(Date.now()).slice(-9)}`;
const listenerMobile = `8${String(Date.now()).slice(-9)}`;

async function req(method, path, { token, body, label } = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const start = performance.now();
  let status = 0;
  let ok = false;
  let error = null;
  let data = null;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    ok = res.ok;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  } catch (e) {
    error = e.message;
  }

  const ms = Math.round(performance.now() - start);
  return { method, path, label: label || path, ms, status, ok, error, data };
}

async function auth(type, mobile) {
  await req('POST', '/auth/request-otp', {
    body: {
      type,
      mobileNumber: mobile,
      countryCode: '+91',
      dateOfBirth: '2000-06-18',
      gender: type === 'LISTENER' ? 'FEMALE' : 'MALE',
    },
  });
  const verify = await req('POST', '/auth/verify-otp', {
    body: {
      type,
      mobileNumber: mobile,
      otp: '123456',
      countryCode: '+91',
    },
  });
  if (!verify.ok || !verify.data?.data?.token) {
    throw new Error(`Auth failed for ${type}: ${JSON.stringify(verify.data)}`);
  }
  return {
    token: verify.data.data.token,
    user: verify.data.data.user,
  };
}

function buildTests(ctx) {
  const { customerToken, listenerToken, customerUser, listenerUser } = ctx;
  const placeholderListenerId = '507f1f77bcf86cd799439011';
  const placeholderSessionId = '507f1f77bcf86cd799439012';
  const placeholderGiftId = '507f1f77bcf86cd799439013';
  const placeholderRoomId = '507f1f77bcf86cd799439014';
  const placeholderStickerId = '507f1f77bcf86cd799439015';
  const placeholderFeedbackId = '507f1f77bcf86cd799439016';
  const placeholderWithdrawalId = '507f1f77bcf86cd799439017';

  const tests = [];

  const add = (role, method, path, opts = {}) => {
    tests.push({ role, method, path, ...opts });
  };

  // ─── AUTH (public) ───
  add('CUSTOMER', 'POST', '/auth/request-otp', {
    body: { type: 'CUSTOMER', mobileNumber: `7${String(Date.now()).slice(-9)}`, countryCode: '+91', dateOfBirth: '2000-01-15', gender: 'MALE' },
    label: 'POST /auth/request-otp (CUSTOMER)',
  });
  add('LISTENER', 'POST', '/auth/request-otp', {
    body: { type: 'LISTENER', mobileNumber: `6${String(Date.now()).slice(-9)}`, countryCode: '+91', dateOfBirth: '1998-03-15', gender: 'FEMALE' },
    label: 'POST /auth/request-otp (LISTENER)',
  });
  add('CUSTOMER', 'POST', '/auth/guest-login', {
    body: { deviceId: `device-${Date.now()}`, dateOfBirth: '2000-06-18' },
    label: 'POST /auth/guest-login',
  });

  // ─── PUBLIC ───
  add('CUSTOMER', 'GET', '/countries', { label: 'GET /countries' });

  // ─── CUSTOMER authenticated ───
  const c = customerToken;
  add('CUSTOMER', 'GET', '/users/me', { token: c });
  add('CUSTOMER', 'GET', '/users/me/settings', { token: c });
  add('CUSTOMER', 'GET', '/home/user-home', { token: c });
  add('CUSTOMER', 'GET', '/listeners?page=1&limit=5', { token: c, label: 'GET /listeners (browse)' });
  add('CUSTOMER', 'GET', '/listeners/profile', { token: c, label: 'GET /listeners/profile' });
  add('CUSTOMER', 'GET', '/wallets/me', { token: c });
  add('CUSTOMER', 'GET', '/wallets/me/coin-transactions?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/wallets/me/payment-transactions?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/follows/following?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/follows/favorites?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', `/follows/counts/${customerUser._id}`, { token: c });
  add('CUSTOMER', 'GET', `/follows/status/${placeholderListenerId}`, { token: c });
  add('CUSTOMER', 'GET', '/wishlist?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', `/wishlist/status/${placeholderListenerId}`, { token: c });
  add('CUSTOMER', 'GET', '/chats/sessions', { token: c });
  add('CUSTOMER', 'GET', `/reviews/listeners/${placeholderListenerId}?page=1&limit=5`, { token: c });
  add('CUSTOMER', 'GET', '/feedback/me?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/daily-rewards/state', { token: c });
  add('CUSTOMER', 'GET', '/daily-rewards/inventory', { token: c });
  add('CUSTOMER', 'GET', '/avatars', { token: c });
  add('CUSTOMER', 'GET', '/gifts?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/gifts/history/sent?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/gifts/history/received?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/live-rooms?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/stickers?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/sticker-categories?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/xp/profile', { token: c });
  add('CUSTOMER', 'GET', '/xp/history?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/xp/leaderboard?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/xp/rewards/inventory?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/search/listeners?q=&page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/notifications?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/notifications/unread-count', { token: c });
  add('CUSTOMER', 'GET', '/anchor-levels', { token: c });
  add('CUSTOMER', 'GET', '/withdrawals/config', { token: c });
  add('CUSTOMER', 'GET', '/withdrawals/quote?coins=100', { token: c });
  add('CUSTOMER', 'GET', '/withdrawals/bank-accounts', { token: c });
  add('CUSTOMER', 'GET', '/withdrawals/me?page=1&limit=10', { token: c });
  add('CUSTOMER', 'GET', '/referrals/details', { token: c });
  add('CUSTOMER', 'GET', '/coin-packs', { token: c });
  add('CUSTOMER', 'GET', '/languages', { token: c });
  add('CUSTOMER', 'GET', '/banners', { token: c });
  add('CUSTOMER', 'GET', '/company/profile', { token: c });
  add('CUSTOMER', 'GET', '/company', { token: c });

  // ─── LISTENER authenticated ───
  const l = listenerToken;
  add('LISTENER', 'GET', '/users/me', { token: l });
  add('LISTENER', 'GET', '/users/me/settings', { token: l });
  add('LISTENER', 'GET', '/home/user-home', { token: l });
  add('LISTENER', 'GET', '/listeners/profile', { token: l });
  add('LISTENER', 'GET', '/listeners/dashboard', { token: l });
  add('LISTENER', 'GET', '/listeners/dashboard/overview', { token: l });
  add('LISTENER', 'GET', '/listeners/dashboard/sessions?page=1&limit=10', { token: l });
  add('LISTENER', 'PATCH', '/listeners/availability/toggle', { token: l });
  add('LISTENER', 'GET', '/wallets/me', { token: l });
  add('LISTENER', 'GET', '/wallets/me/coin-transactions?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/follows/following?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', `/follows/counts/${listenerUser._id}`, { token: l });
  add('LISTENER', 'GET', '/chats/sessions', { token: l });
  add('LISTENER', 'GET', '/feedback/me?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/daily-rewards/state', { token: l });
  add('LISTENER', 'GET', '/daily-rewards/inventory', { token: l });
  add('LISTENER', 'GET', '/avatars', { token: l });
  add('LISTENER', 'GET', '/gifts?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/gifts/history/received?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/live-rooms?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/stickers?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/xp/profile', { token: l });
  add('LISTENER', 'GET', '/xp/history?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/xp/leaderboard?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/search/listeners?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/notifications?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/notifications/unread-count', { token: l });
  add('LISTENER', 'GET', '/anchor-levels/me/status', { token: l });
  add('LISTENER', 'GET', '/anchor-levels/me/rewards?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/anchor-levels', { token: l });
  add('LISTENER', 'GET', '/withdrawals/config', { token: l });
  add('LISTENER', 'GET', '/withdrawals/bank-accounts', { token: l });
  add('LISTENER', 'GET', '/withdrawals/me?page=1&limit=10', { token: l });
  add('LISTENER', 'GET', '/referrals/details', { token: l });
  add('LISTENER', 'GET', '/coin-packs', { token: l });
  add('LISTENER', 'GET', '/languages', { token: l });
  add('LISTENER', 'GET', '/banners', { token: l });

  return tests;
}

async function main() {
  console.log('Authenticating CUSTOMER and LISTENER...\n');
  const customer = await auth('CUSTOMER', customerMobile);
  const listener = await auth('LISTENER', listenerMobile);

  const ctx = {
    customerToken: customer.token,
    listenerToken: listener.token,
    customerUser: customer.user,
    listenerUser: listener.user,
  };

  const tests = buildTests(ctx);
  const results = [];
  const slow = [];

  // Warm-up
  await req('GET', '/countries');

  for (const t of tests) {
    const token = t.role === 'CUSTOMER' ? ctx.customerToken : ctx.listenerToken;
    const r = await req(t.method, t.path, { token: t.token || token, body: t.body, label: t.label });
    const entry = {
      role: t.role,
      method: r.method,
      api: r.label,
      ms: r.ms,
      status: r.status,
      ok: r.ok,
    };
    results.push(entry);
    if (r.ms > 200) {
      slow.push({ ...entry, error: r.error, message: r.data?.message });
    }
    // small gap to avoid rate limit noise
    await new Promise((res) => setTimeout(res, 10));
  }

  const passed = results.filter((r) => r.ms <= 200);
  const failed = results.filter((r) => r.ms > 200);

  console.log(JSON.stringify({ summary: { total: results.length, under200ms: passed.length, over200ms: failed.length }, slow, all: results }, null, 2));
}

main().catch((e) => {
  console.error('Test run failed:', e.message);
  process.exit(1);
});
