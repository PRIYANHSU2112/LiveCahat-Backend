/**
 * Full API functional + performance test suite
 * Usage: DISABLE_RATE_LIMIT=true node scripts/full-api-test.mjs
 */
import fs from 'fs';
import path from 'path';
import { performance } from 'node:perf_hooks';
import ExcelJS from 'exceljs';

const BASE = process.env.API_BASE || 'http://localhost:5000/api/v1';
const REPORT_DIR = path.join(
  process.cwd(),
  'reports',
  `api-test-${new Date().toISOString().slice(0, 10)}`
);
const RESPONSES_DIR = path.join(REPORT_DIR, 'responses');

const ADMIN_TOKEN = 'mock-jwt-token';
const AGENT_TOKEN = 'mock-jwt-token';

const SLOW_ANALYSIS = {
  'GET /users/me': {
    reason: 'MongoDB user lookup + Redis auth cache read/write on cache miss',
    optimization: 'Extend auth profile cache TTL; project only required fields in lean query',
  },
  'GET /daily-rewards/state': {
    reason: 'Multiple Redis reads + MongoDB config/reward lookups for streak state',
    optimization: 'Cache daily-reward state per user in Redis; batch config fetch',
  },
  'POST /daily-rewards/claim': {
    reason: 'MongoDB transaction: state lock, claim log insert, config resolve, wallet credit, inventory update',
    optimization: 'Preload reward configs; reduce transaction scope; async non-critical side effects',
  },
  'GET /listeners/dashboard': {
    reason: 'Aggregates sessions, earnings, stats across multiple collections',
    optimization: 'Pre-aggregate listener stats in Redis/Mongo; add compound indexes on session queries',
  },
  'PUT /listeners/rates': {
    reason: 'Profile update + listener model write + possible cache invalidation',
    optimization: 'Single lean update; defer non-critical cache busts',
  },
  'PUT /listeners/availability': {
    reason: 'Presence/Redis status update + MongoDB profile write',
    optimization: 'Pipeline Redis presence update with profile write',
  },
  'PATCH /listeners/availability/toggle': {
    reason: 'Read current status then Redis + MongoDB dual write',
    optimization: 'Atomic toggle in Redis; async MongoDB sync',
  },
  'GET /chats/conversations': {
    reason: 'Heavy MongoDB aggregation grouping messages + user lookup + Redis presence batch',
    optimization: 'Ensure indexes on senderId/receiverId/createdAt; cache conversation list snapshot',
  },
  'GET /listeners': {
    reason: 'Paginated listener browse with profile joins and filters',
    optimization: 'Use lean()+select(); add indexes on kycStatus and availability fields',
  },
  'GET /gifts/admin/analytics': {
    reason: 'Aggregation across gift transactions and user data',
    optimization: 'Materialized daily analytics collection; index giftTransaction.createdAt',
  },
  'POST /wallets/payments/create-order': {
    reason: 'External Razorpay API call + order persistence',
    optimization: 'Cache coin-pack metadata; set Razorpay timeout; async order logging',
  },
  'POST /avatars/:id/unlock': {
    reason: 'Wallet debit transaction + avatar unlock write + cache invalidation',
    optimization: 'Combine wallet+user update in single transaction; batch cache deletes',
  },
  'POST /users/admin': {
    reason: 'User creation with password hash + duplicate checks',
    optimization: 'Index email/mobile; async welcome notification',
  },
  'POST /users/listener': {
    reason: 'Creates user + listener profile + wallet seed',
    optimization: 'Use insertMany/bulk; defer wallet seed to background job',
  },
  'GET /wallets/me/coin-transactions': {
    reason: 'Paginated transaction history with sorting',
    optimization: 'Index walletId+createdAt; cap default page size',
  },
  'GET /search/listeners': {
    reason: 'Text/search filters across listener profiles',
    optimization: 'Add text index or dedicated search service; limit populate depth',
  },
  'GET /xp/leaderboard': {
    reason: 'Sorted XP ranking query across users',
    optimization: 'Cache top-N leaderboard in Redis with periodic refresh',
  },
  'POST /auth/verify-otp': {
    reason: 'User create/update + wallet seed + JWT generation + Redis OTP cleanup',
    optimization: 'Defer non-critical side effects; index mobileNumber+type',
  },
  'POST /auth/guest-login': {
    reason: 'Device lookup/create + wallet seed + JWT',
    optimization: 'Index deviceId; cache guest session',
  },
  'POST /auth/request-otp': {
    reason: 'Redis write + user validation + OTP session storage',
    optimization: 'Keep validation lightweight; reuse Redis pipeline',
  },
};

function analysisKey(method, endpointPath) {
  const normalized = endpointPath.replace(/\?.*$/, '').replace(/\/[a-f0-9]{24}/gi, '/:id');
  return `${method} ${normalized}` || `${method} ${endpointPath.split('?')[0]}`;
}

function getSlowAnalysis(method, endpointPath) {
  const key = analysisKey(method, endpointPath);
  if (SLOW_ANALYSIS[key]) return SLOW_ANALYSIS[key];
  const base = endpointPath.split('?')[0].replace(/\/[a-f0-9]{24}/gi, '/:id');
  for (const [k, v] of Object.entries(SLOW_ANALYSIS)) {
    if (k.endsWith(base.replace(BASE, '')) || base.includes(k.split(' ')[1])) return v;
  }
  if (endpointPath.includes('/admin')) {
    return {
      reason: 'Admin list/aggregate endpoints often scan larger datasets',
      optimization: 'Add pagination defaults, indexes on status/createdAt, lean queries',
    };
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    return {
      reason: 'Write path includes validation + MongoDB write + possible side effects',
      optimization: 'Use bulk writes where applicable; defer notifications/async jobs',
    };
  }
  return {
    reason: 'Network + middleware stack (auth, validation, MongoDB/Redis)',
    optimization: 'Profile with MongoDB explain(); ensure indexes on filter/sort fields',
  };
}

async function req(method, endpointPath, { token, body, formData, expectedStatus = [200, 201, 204], label, module, role, skipPassCheck = false, remark = '' } = {}) {
  const url = `${BASE}${endpointPath}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !formData) headers['Content-Type'] = 'application/json';

  const start = performance.now();
  let status = 0;
  let data = null;
  let rawText = '';
  let error = null;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: formData || (body ? JSON.stringify(body) : undefined),
    });
    status = res.status;
    rawText = await res.text();
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = rawText;
    }
  } catch (e) {
    error = e.message;
  }

  const ms = Math.round(performance.now() - start);
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  let pass = !error && expected.includes(status);
  if (!skipPassCheck && pass && status >= 200 && status < 300 && data && typeof data === 'object' && 'success' in data) {
    pass = data.success === true;
  }

  return {
    module: module || 'unknown',
    role: role || 'PUBLIC',
    method,
    endpoint: endpointPath,
    label: label || `${method} ${endpointPath}`,
    statusCode: status,
    responseTimeMs: ms,
    passFail: pass ? 'Pass' : 'Fail',
    returnedData: data ?? rawText ?? error,
    remarks: remark || (error ? error : !pass ? `Expected ${expected.join('|')}, got ${status}` : ''),
    error,
  };
}

async function authOtp(type, mobile) {
  await req('POST', '/auth/request-otp', {
    module: 'auth',
    role: 'PUBLIC',
    body: {
      type,
      mobileNumber: mobile,
      countryCode: '+91',
      dateOfBirth: '2000-06-18',
      gender: type === 'LISTENER' ? 'FEMALE' : 'MALE',
    },
    expectedStatus: [200],
    skipPassCheck: true,
  });
  const verify = await req('POST', '/auth/verify-otp', {
    module: 'auth',
    role: 'PUBLIC',
    body: { type, mobileNumber: mobile, otp: '123456', countryCode: '+91' },
    expectedStatus: [200],
  });
  if (!verify.returnedData?.data?.token) throw new Error(`Auth failed for ${type}`);
  return { token: verify.returnedData.data.token, user: verify.returnedData.data.user };
}

function pickId(res, keys = ['_id', 'id']) {
  const d = res?.returnedData?.data;
  if (!d) return null;
  if (Array.isArray(d)) return d[0]?._id || d[0]?.id || null;
  if (Array.isArray(d.items)) return d.items[0]?._id || null;
  if (Array.isArray(d.docs)) return d.docs[0]?._id || null;
  if (Array.isArray(d.results)) return d.results[0]?._id || null;
  for (const k of keys) if (d[k]) return d[k];
  if (d.data && Array.isArray(d.data)) return d.data[0]?._id || null;
  return null;
}

function buildTests(ctx) {
  const { customerToken, listenerToken, customerUser, listenerUser, customerMobile, ids } = ctx;
  const A = ADMIN_TOKEN;
  const c = customerToken;
  const l = listenerToken;
  const T = [];

  const add = (module, role, method, endpoint, opts = {}) => {
    T.push({ module, role, method, endpoint, ...opts });
  };

  // ─── AUTH (public) ───
  add('auth', 'PUBLIC', 'POST', '/auth/request-otp', {
    body: { type: 'CUSTOMER', mobileNumber: `7${Date.now().toString().slice(-9)}`, countryCode: '+91', dateOfBirth: '2000-01-15', gender: 'MALE' },
    label: 'POST /auth/request-otp (new customer)',
  });
  add('auth', 'PUBLIC', 'POST', '/auth/guest-login', {
    body: { deviceId: `dev-${Date.now()}`, dateOfBirth: '2000-06-18' },
    label: 'POST /auth/guest-login',
  });
  add('auth', 'PUBLIC', 'POST', '/auth/direct-login', {
    body: { token: 'invalid-magic-token' },
    expectedStatus: [404, 400],
    skipPassCheck: true,
    remark: 'Expected fail without valid magic token',
  });
  add('auth', 'CUSTOMER', 'POST', '/auth/link-account', {
    token: c,
    body: { mobileNumber: `5${Date.now().toString().slice(-9)}`, countryCode: '+91', otp: '123456' },
    expectedStatus: [200, 400],
    remark: 'May fail if OTP not requested for link flow',
  });

  // ─── COUNTRIES ───
  add('countries', 'PUBLIC', 'GET', '/countries', { label: 'GET /countries' });

  // ─── COMPANY ───
  add('company', 'PUBLIC', 'GET', '/company/profile');
  add('company', 'CUSTOMER', 'GET', '/company', { token: c });
  if (ids.companyId) add('company', 'CUSTOMER', 'GET', `/company/${ids.companyId}`, { token: c });
  add('company', 'ADMIN', 'POST', '/company', {
    token: A,
    body: { name: `TestCo ${Date.now()}`, email: `co${Date.now()}@test.com`, phone: '9999999999', address: 'Test' },
    expectedStatus: [200, 201],
  });
  if (ids.companyId) {
    add('company', 'ADMIN', 'PUT', `/company/${ids.companyId}`, {
      token: A,
      body: { name: 'Updated Test Co' },
    });
  }

  // ─── USERS ───
  add('users', 'CUSTOMER', 'GET', '/users/me', { token: c });
  add('users', 'LISTENER', 'GET', '/users/me', { token: l });
  add('users', 'ADMIN', 'GET', '/users/me', { token: A });
  add('users', 'CUSTOMER', 'GET', '/users/me/settings', { token: c });
  add('users', 'CUSTOMER', 'PATCH', '/users/me/settings', {
    token: c,
    body: { notificationsEnabled: true },
  });
  add('users', 'CUSTOMER', 'PUT', '/users/me', {
    token: c,
    body: { firstName: customerUser.firstName || 'Test', lastName: 'Customer' },
  });
  add('users', 'ADMIN', 'GET', '/users?page=1&limit=5', { token: A });
  if (ids.customerId) add('users', 'ADMIN', 'GET', `/users/${ids.customerId}`, { token: A });
  add('users', 'ADMIN', 'POST', '/users/admin', {
    token: A,
    body: { firstName: 'Tmp', lastName: 'Admin', email: `adm${Date.now()}@test.com`, mobileNumber: `3${Date.now().toString().slice(-9)}` },
    expectedStatus: [200, 201],
  });
  add('users', 'ADMIN', 'POST', '/users/agent', {
    token: A,
    body: {
      firstName: 'Tmp',
      lastName: 'Agent',
      email: `agt${Date.now()}@test.com`,
      password: 'Test1234!',
      mobileNumber: `4${Date.now().toString().slice(-9)}`,
      commissionPercentage: 10,
    },
    expectedStatus: [200, 201],
  });

  // ─── HOME ───
  add('home', 'CUSTOMER', 'GET', '/home/user-home?page=1&limit=5', { token: c });
  add('home', 'LISTENER', 'GET', '/home/user-home?page=1&limit=5', { token: l });
  add('home', 'LISTENER', 'GET', '/home/listener-home?onlineLimit=5&newLimit=5&popularLimit=5', { token: l });
  add('home', 'CUSTOMER', 'GET', '/home/listener-home', { token: c, expectedStatus: [403] });

  // ─── MATCH ───
  add('match', 'ADMIN', 'GET', '/match/admin/config', { token: A });
  add('match', 'ADMIN', 'PUT', '/match/admin/config', {
    token: A,
    body: { instantMatchFee: 5, isEnabled: true },
  });
  add('match', 'CUSTOMER', 'GET', '/match/fee', { token: c });
  add('match', 'CUSTOMER', 'GET', '/match/status', { token: c });
  add('match', 'CUSTOMER', 'GET', '/match/discover?page=1&limit=10&sort=combined', { token: c });
  add('match', 'CUSTOMER', 'POST', '/match/instant', {
    token: c,
    body: { mode: 'CHAT' },
    expectedStatus: [200, 404, 402, 503],
    remark: '404 if no ONLINE listener; 402 if wallet too low; debits instantMatchFee on success',
  });

  // ─── LISTENERS ───
  add('listeners', 'CUSTOMER', 'GET', '/listeners?page=1&limit=5', { token: c });
  add('listeners', 'CUSTOMER', 'GET', '/listeners/profile', { token: c, expectedStatus: [200, 404], remark: '404 if customer has no listener profile' });
  add('listeners', 'LISTENER', 'GET', '/listeners/profile', { token: l });
  add('listeners', 'LISTENER', 'PUT', '/listeners/rates', {
    token: l,
    body: { voiceRate: 15, videoRate: 25 },
  });
  add('listeners', 'LISTENER', 'PUT', '/listeners/availability', {
    token: l,
    body: { availability: 'ONLINE' },
  });
  add('listeners', 'LISTENER', 'PATCH', '/listeners/availability/toggle', { token: l });
  add('listeners', 'LISTENER', 'GET', '/listeners/dashboard', { token: l });
  add('listeners', 'LISTENER', 'GET', '/listeners/dashboard/overview', { token: l });
  add('listeners', 'LISTENER', 'GET', '/listeners/dashboard/sessions?page=1&limit=5', { token: l });

  // ─── AGENT ───
  add('listeners', 'AGENT', 'GET', '/listeners/agent?page=1&limit=5', { token: AGENT_TOKEN });
  add('listeners', 'AGENT', 'GET', '/listeners/agent/stats', { token: AGENT_TOKEN });
  add('listeners', 'AGENT', 'POST', '/listeners/agent', {
    token: AGENT_TOKEN,
    body: {
      name: 'Agent Listener Test',
      username: `agentlst${Date.now().toString().slice(-6)}`,
      email: `agentlst${Date.now()}@test.com`,
      phone: `2${Date.now().toString().slice(-9)}`,
      country: 'India',
      profileStatus: 'completed',
    },
    expectedStatus: [200, 201],
  });

  // ─── AGENT REVENUE ───
  add('agent', 'AGENT', 'GET', '/agent/revenue/summary?period=month', { token: AGENT_TOKEN });
  add('agent', 'AGENT', 'GET', '/agent/revenue/graphs?period=6months', { token: AGENT_TOKEN });
  add('agent', 'AGENT', 'GET', '/agent/revenue/history?page=1&limit=20&source=all&status=all', {
    token: AGENT_TOKEN,
  });
  add('agent', 'CUSTOMER', 'GET', '/agent/revenue/summary?period=month', { token: c, expectedStatus: [403] });
  add('agent', 'LISTENER', 'GET', '/agent/revenue/summary?period=month', { token: l, expectedStatus: [403] });

  // ─── LANGUAGES ───
  add('languages', 'CUSTOMER', 'GET', '/languages', { token: c });
  if (ids.languageId) add('languages', 'CUSTOMER', 'GET', `/languages/${ids.languageId}`, { token: c });
  add('languages', 'ADMIN', 'POST', '/languages', {
    token: A,
    body: { name: `Lang${Date.now().toString().slice(-5)}`, code: `l${Date.now().toString().slice(-4)}` },
    expectedStatus: [200, 201],
  });

  // ─── COIN PACKS ───
  add('coin-packs', 'CUSTOMER', 'GET', '/coin-packs', { token: c });
  if (ids.coinPackId) add('coin-packs', 'CUSTOMER', 'GET', `/coin-packs/${ids.coinPackId}`, { token: c });
  add('coin-packs', 'ADMIN', 'POST', '/coin-packs', {
    token: A,
    body: { name: `Pack${Date.now()}`, coins: 100, price: 99, currency: 'INR', isActive: true },
    expectedStatus: [200, 201],
  });

  // ─── WALLETS ───
  add('wallets', 'PUBLIC', 'POST', '/wallets/payments/webhook-mock', {
    body: { event: 'payment.captured', payload: {} },
    expectedStatus: [200, 400],
    remark: 'Mock webhook – may fail without full payload',
  });
  add('wallets', 'CUSTOMER', 'GET', '/wallets/me', { token: c });
  add('wallets', 'LISTENER', 'GET', '/wallets/me', { token: l });
  add('wallets', 'CUSTOMER', 'GET', '/wallets/me/coin-transactions?page=1&limit=10', { token: c });
  add('wallets', 'CUSTOMER', 'GET', '/wallets/me/payment-transactions?page=1&limit=10', { token: c });
  add('wallets', 'CUSTOMER', 'POST', '/wallets/payments/create-order', {
    token: c,
    body: { coinPackId: ids.coinPackId || '507f1f77bcf86cd799439011' },
    expectedStatus: [200, 201, 400, 404],
    remark: 'Razorpay dependency – may fail with test keys',
  });
  add('wallets', 'ADMIN', 'GET', '/wallets?page=1&limit=5', { token: A });
  add('wallets', 'ADMIN', 'GET', '/wallets/coin-transactions?page=1&limit=5', { token: A });
  add('wallets', 'ADMIN', 'GET', '/wallets/payment-transactions?page=1&limit=5', { token: A });
  if (ids.customerId) {
    add('wallets', 'ADMIN', 'POST', `/wallets/user/${ids.customerId}/credit-debit`, {
      token: A,
      body: { amount: 10, type: 'CREDIT', referenceType: 'BONUS', description: 'API test credit' },
      expectedStatus: [200, 201],
    });
  }
  if (ids.walletId) {
    add('wallets', 'ADMIN', 'GET', `/wallets/${ids.walletId}`, { token: A });
    add('wallets', 'ADMIN', 'PUT', `/wallets/${ids.walletId}/status`, {
      token: A,
      body: { status: 'ACTIVE' },
    });
  }

  // ─── FOLLOWS ───
  if (ids.approvedListenerId) {
    add('follows', 'CUSTOMER', 'POST', `/follows/${ids.approvedListenerId}`, { token: c, expectedStatus: [200, 201] });
    add('follows', 'CUSTOMER', 'GET', `/follows/status/${ids.approvedListenerId}`, { token: c });
    add('follows', 'CUSTOMER', 'PATCH', `/follows/favorite/${ids.approvedListenerId}`, { token: c });
    add('follows', 'CUSTOMER', 'GET', `/follows/followers/${ids.approvedListenerId}?page=1&limit=5`, { token: c });
  }
  add('follows', 'CUSTOMER', 'GET', '/follows/following?page=1&limit=10', { token: c });
  add('follows', 'CUSTOMER', 'GET', '/follows/favorites?page=1&limit=10', { token: c });
  add('follows', 'CUSTOMER', 'GET', `/follows/counts/${customerUser._id}`, { token: c });
  add('follows', 'ADMIN', 'GET', '/follows/top?page=1&limit=5', { token: A });

  // ─── WISHLIST ───
  if (ids.approvedListenerId) {
    add('wishlist', 'CUSTOMER', 'POST', `/wishlist/${ids.approvedListenerId}`, { token: c, expectedStatus: [200, 201] });
    add('wishlist', 'CUSTOMER', 'GET', `/wishlist/status/${ids.approvedListenerId}`, { token: c });
  }
  add('wishlist', 'CUSTOMER', 'GET', '/wishlist?page=1&limit=10', { token: c });

  // ─── GIFTS ───
  add('gifts', 'CUSTOMER', 'GET', '/gifts?page=1&limit=10', { token: c });
  add('gifts', 'CUSTOMER', 'GET', '/gifts/history/sent?page=1&limit=5', { token: c });
  add('gifts', 'CUSTOMER', 'GET', '/gifts/history/received?page=1&limit=5', { token: l });
  if (ids.giftId) add('gifts', 'CUSTOMER', 'GET', `/gifts/${ids.giftId}`, { token: c });
  add('gifts', 'ADMIN', 'GET', '/gifts/admin/analytics', { token: A });
  add('gifts', 'ADMIN', 'POST', '/gifts', {
    token: A,
    body: { name: `Gift${Date.now()}`, coin: 10, icon: 'https://example.com/g.png', category: 'REGULAR' },
    expectedStatus: [200, 201],
  });

  // ─── CHATS ───
  add('chats', 'CUSTOMER', 'GET', '/chats/conversations?page=1&limit=10', { token: c });
  add('chats', 'LISTENER', 'GET', '/chats/conversations?page=1&limit=10', { token: l });
  add('chats', 'CUSTOMER', 'GET', '/chats/sessions?limit=10', { token: c });
  if (ids.sessionId) {
    add('chats', 'CUSTOMER', 'GET', `/chats/sessions/${ids.sessionId}/messages?page=1&limit=20`, { token: c });
  }

  // ─── CALLS ───
  if (ids.approvedListenerId) {
    add('calls', 'CUSTOMER', 'POST', '/calls/initiate', {
      token: c,
      body: { listenerId: ids.approvedListenerId, mode: 'AUDIO' },
      expectedStatus: [200, 201, 400, 403],
      remark: 'Requires listener ONLINE + balance + KYC approved',
    });
  }
  if (ids.sessionId) {
    add('calls', 'CUSTOMER', 'GET', `/calls/token/${ids.sessionId}`, {
      token: c,
      expectedStatus: [200, 400, 404],
    });
    add('calls', 'CUSTOMER', 'POST', '/calls/end', {
      token: c,
      body: { sessionId: ids.sessionId },
      expectedStatus: [200, 400, 404],
    });
  }

  // ─── LIVE ROOMS ───
  add('live-rooms', 'CUSTOMER', 'GET', '/live-rooms?page=1&limit=5', { token: c });
  if (ids.liveRoomId) {
    add('live-rooms', 'CUSTOMER', 'GET', `/live-rooms/${ids.liveRoomId}`, { token: c });
    add('live-rooms', 'CUSTOMER', 'POST', `/live-rooms/${ids.liveRoomId}/agora-token`, {
      token: c,
      body: { role: 'SUBSCRIBER' },
      expectedStatus: [200, 400, 404],
    });
  }

  // ─── BANNERS ───
  add('banners', 'CUSTOMER', 'GET', '/banners', { token: c });
  add('banners', 'ADMIN', 'GET', '/banners/all?page=1&limit=5', { token: A });
  if (ids.bannerId) {
    add('banners', 'ADMIN', 'GET', `/banners/${ids.bannerId}`, { token: A });
    add('banners', 'ADMIN', 'PATCH', `/banners/${ids.bannerId}/toggle-active`, {
      token: A,
      body: { isActive: true },
    });
  }

  // ─── DAILY REWARDS ───
  add('daily-rewards', 'CUSTOMER', 'GET', '/daily-rewards/state', { token: c });
  add('daily-rewards', 'CUSTOMER', 'POST', '/daily-rewards/claim', { token: c, expectedStatus: [200, 400] });
  add('daily-rewards', 'CUSTOMER', 'GET', '/daily-rewards/inventory', { token: c });
  add('daily-rewards', 'ADMIN', 'PUT', '/daily-rewards/admin/config/days', {
    token: A,
    body: { days: [{ day: 1, rewardType: 'COINS', rewardValue: 5 }] },
    expectedStatus: [200, 400],
  });

  // ─── AVATARS ───
  add('avatars', 'CUSTOMER', 'GET', '/avatars', { token: c });
  if (ids.avatarId) {
    add('avatars', 'CUSTOMER', 'POST', `/avatars/${ids.avatarId}/unlock`, { token: c, expectedStatus: [200, 400] });
  }
  add('avatars', 'ADMIN', 'POST', '/avatars/admin', {
    token: A,
    body: { name: `Av${Date.now()}`, image: 'https://example.com/a.png', priceType: 'FREE', price: 0, category: 'REGULAR' },
    expectedStatus: [200, 201],
  });

  // ─── STICKERS ───
  add('sticker-categories', 'CUSTOMER', 'GET', '/sticker-categories?page=1&limit=10', { token: c });
  add('stickers', 'CUSTOMER', 'GET', '/stickers?page=1&limit=10', { token: c });
  if (ids.stickerCategoryId) {
    add('sticker-categories', 'ADMIN', 'POST', '/sticker-categories', {
      token: A,
      body: { name: `Cat${Date.now()}`, isActive: true },
      expectedStatus: [200, 201],
    });
  }
  add('sticker-categories', 'ADMIN', 'POST', '/sticker-categories', {
    token: A,
    body: { name: `Cat${Date.now()}`, isActive: true },
    expectedStatus: [200, 201],
  });
  add('stickers', 'ADMIN', 'POST', '/stickers', {
    token: A,
    body: {
      name: `Stk${Date.now()}`,
      categoryId: ids.stickerCategoryId || '507f1f77bcf86cd799439011',
      imageUrl: 'https://example.com/s.png',
      coinCost: 0,
      isActive: true,
    },
    expectedStatus: [200, 201, 400],
  });

  // ─── REVIEWS ───
  if (ids.approvedListenerId) {
    add('reviews', 'CUSTOMER', 'POST', `/reviews/listeners/${ids.approvedListenerId}`, {
      token: c,
      body: { rating: 5, reviewComment: 'Great listener' },
      expectedStatus: [200, 201],
    });
    add('reviews', 'CUSTOMER', 'GET', `/reviews/listeners/${ids.approvedListenerId}?page=1&limit=5`, { token: c });
  }

  // ─── FEEDBACK ───
  add('feedback', 'CUSTOMER', 'POST', '/feedback', {
    token: c,
    body: { message: 'API test feedback', category: 'OTHER', rating: 4 },
    expectedStatus: [200, 201],
  });
  add('feedback', 'CUSTOMER', 'GET', '/feedback/me?page=1&limit=5', { token: c });
  add('feedback', 'ADMIN', 'GET', '/feedback?page=1&limit=5', { token: A });

  // ─── REFERRALS ───
  add('referrals', 'CUSTOMER', 'GET', '/referrals/details', { token: c });
  add('referrals', 'ADMIN', 'GET', '/referrals/admin/config', { token: A });
  add('referrals', 'ADMIN', 'PUT', '/referrals/admin/config', {
    token: A,
    body: { referrerReward: 10, refereeReward: 5, isActive: true },
    expectedStatus: [200, 400],
  });

  // ─── WITHDRAWALS ───
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/config', { token: l });
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/quote?coins=100', { token: l });
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/bank-accounts', { token: l });
  add('withdrawals', 'LISTENER', 'POST', '/withdrawals/bank-accounts', {
    token: l,
    body: {
      methodType: 'BANK',
      accountHolderName: 'Test Listener',
      accountNumber: '1234567890',
      ifscCode: 'SBIN0001234',
      bankName: 'SBI',
    },
    expectedStatus: [200, 201],
  });
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/me?page=1&limit=5', { token: l });
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/me/stats?status=PENDING', { token: l });
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/me/stats?status=APPROVED', { token: l });
  add('withdrawals', 'LISTENER', 'GET', '/withdrawals/me/stats?status=REJECTED', { token: l });
  add('withdrawals', 'ADMIN', 'GET', '/withdrawals/admin?page=1&limit=5', { token: A });
  add('withdrawals', 'ADMIN', 'PUT', '/withdrawals/admin/config', {
    token: A,
    body: { coinToInrRate: 1, minWithdrawalCoins: 100, isActive: true },
    expectedStatus: [200, 400],
  });

  // ─── ANCHOR LEVELS ───
  add('anchor-levels', 'LISTENER', 'GET', '/anchor-levels/me/status', { token: l });
  add('anchor-levels', 'LISTENER', 'GET', '/anchor-levels/me/rewards?page=1&limit=5', { token: l });
  add('anchor-levels', 'CUSTOMER', 'GET', '/anchor-levels', { token: c });
  add('anchor-levels', 'ADMIN', 'GET', '/anchor-levels/admin', { token: A });
  add('anchor-levels', 'ADMIN', 'GET', '/anchor-levels/admin/claims?page=1&limit=5', { token: A });
  add('anchor-levels', 'ADMIN', 'POST', '/anchor-levels/admin', {
    token: A,
    body: { level: 99, name: 'TestLevel', minMinutes: 0, rewardCoins: 10 },
    expectedStatus: [200, 201, 400],
  });

  // ─── NOTIFICATIONS ───
  add('notifications', 'CUSTOMER', 'GET', '/notifications?page=1&limit=10', { token: c });
  add('notifications', 'CUSTOMER', 'GET', '/notifications/unread-count', { token: c });
  add('notifications', 'CUSTOMER', 'PATCH', '/notifications/read-all', { token: c });
  if (ids.customerId) {
    add('notifications', 'ADMIN', 'POST', '/notifications/admin/send', {
      token: A,
      body: { recipientId: ids.customerId, title: 'Test', body: 'Hello from API test', type: 'SYSTEM' },
      expectedStatus: [200, 201],
    });
  }
  add('notifications', 'ADMIN', 'POST', '/notifications/admin/broadcast', {
    token: A,
    body: { title: 'Broadcast', body: 'Test broadcast', type: 'GENERAL', targetRole: 'CUSTOMER' },
    expectedStatus: [200, 201, 400],
  });

  // ─── XP ───
  add('xp', 'CUSTOMER', 'GET', '/xp/profile', { token: c });
  add('xp', 'CUSTOMER', 'GET', '/xp/history?page=1&limit=10', { token: c });
  add('xp', 'CUSTOMER', 'GET', '/xp/leaderboard?page=1&limit=10', { token: c });
  add('xp', 'CUSTOMER', 'GET', '/xp/rewards/inventory?page=1&limit=10', { token: c });
  add('xp', 'ADMIN', 'GET', '/xp/admin/level-configs', { token: A });
  add('xp', 'ADMIN', 'GET', '/xp/admin/rewards', { token: A });
  add('xp', 'ADMIN', 'GET', '/xp/admin/xp-actions', { token: A });
  if (ids.customerId) {
    add('xp', 'ADMIN', 'POST', '/xp/admin/grant', {
      token: A,
      body: { userId: ids.customerId, xpAmount: 5, reason: 'API test grant' },
      expectedStatus: [200, 201],
    });
  }

  // ─── SEARCH ───
  add('search', 'CUSTOMER', 'GET', '/search/listeners?q=&page=1&limit=5', { token: c });
  add('search', 'ADMIN', 'GET', '/search/admin?q=test&page=1&limit=5', { token: A });

  // ─── AUTH login ───
  add('auth', 'PUBLIC', 'POST', '/auth/login', {
    body: { email: 'admin@chatcorner.app', password: 'wrong' },
    expectedStatus: [400, 401, 404],
    skipPassCheck: true,
    remark: 'Login endpoint reachable; credentials may not exist',
  });

  // ─── USERS admin extended ───
  if (ids.customerId) {
    add('users', 'ADMIN', 'POST', `/users/${ids.customerId}/block`, {
      token: A,
      body: { isBlocked: false },
      expectedStatus: [200, 201],
    });
  }
  add('users', 'ADMIN', 'POST', '/users/listener', {
    token: A,
    body: {
      firstName: 'AdminCreated',
      lastName: 'Listener',
      mobileNumber: `1${Date.now().toString().slice(-9)}`,
      countryCode: '+91',
      dateOfBirth: '1995-03-10',
      gender: 'FEMALE',
    },
    expectedStatus: [200, 201],
  });

  // ─── LANGUAGES admin CRUD ───
  if (ids.languageId) {
    add('languages', 'ADMIN', 'PUT', `/languages/${ids.languageId}`, {
      token: A,
      body: { name: 'Updated Lang' },
    });
  }

  // ─── COIN PACKS admin ───
  if (ids.coinPackId) {
    add('coin-packs', 'ADMIN', 'PUT', `/coin-packs/${ids.coinPackId}`, {
      token: A,
      body: { name: 'Updated Pack', coins: 60, price: 59, currency: 'INR', isActive: true },
    });
    add('coin-packs', 'ADMIN', 'PATCH', `/coin-packs/${ids.coinPackId}/toggle`, { token: A });
  }

  // ─── GIFTS send + admin update ───
  if (ids.giftId && ids.approvedListenerId) {
    add('gifts', 'CUSTOMER', 'POST', '/gifts/send', {
      token: c,
      body: { giftId: ids.giftId, receiverId: ids.approvedListenerId, quantity: 1 },
      expectedStatus: [200, 201, 400],
      remark: 'Requires sufficient coin balance',
    });
    add('gifts', 'ADMIN', 'PUT', `/gifts/${ids.giftId}`, {
      token: A,
      body: { name: 'Updated Gift', coinCost: 5, iconUrl: 'https://example.com/g.png', isActive: true },
    });
  }

  // ─── STICKERS extended ───
  if (ids.stickerCategoryId) {
    add('sticker-categories', 'CUSTOMER', 'GET', `/sticker-categories/${ids.stickerCategoryId}`, { token: c });
    add('sticker-categories', 'ADMIN', 'PUT', `/sticker-categories/${ids.stickerCategoryId}`, {
      token: A,
      body: { name: 'Updated Cat', isActive: true },
    });
    add('sticker-categories', 'ADMIN', 'PATCH', `/sticker-categories/${ids.stickerCategoryId}/toggle`, { token: A });
  }
  if (ids.stickerId) {
    add('stickers', 'CUSTOMER', 'GET', `/stickers/${ids.stickerId}`, { token: c });
    add('stickers', 'CUSTOMER', 'POST', `/stickers/${ids.stickerId}/unlock`, { token: c, expectedStatus: [200, 400] });
    add('stickers', 'ADMIN', 'PUT', `/stickers/${ids.stickerId}`, {
      token: A,
      body: { name: 'Upd Stk', categoryId: ids.stickerCategoryId, imageUrl: 'https://example.com/s.png', coinCost: 0, isActive: true },
      expectedStatus: [200, 400],
    });
    add('stickers', 'ADMIN', 'PATCH', `/stickers/${ids.stickerId}/toggle`, { token: A });
  }

  // ─── AVATARS extended ───
  if (ids.avatarId) {
    add('avatars', 'CUSTOMER', 'POST', `/avatars/${ids.avatarId}/set-profile`, { token: c, expectedStatus: [200, 400] });
    add('avatars', 'ADMIN', 'PUT', `/avatars/admin/${ids.avatarId}`, {
      token: A,
      body: { name: 'Upd Av', imageUrl: 'https://example.com/a.png', coinCost: 0 },
      expectedStatus: [200, 400],
    });
  }

  // ─── DAILY REWARDS admin weeks ───
  add('daily-rewards', 'ADMIN', 'PUT', '/daily-rewards/admin/config/weeks', {
    token: A,
    body: { weeks: [{ week: 1, rewardType: 'COINS', rewardValue: 20 }] },
    expectedStatus: [200, 400],
  });

  // ─── REFERRALS apply ───
  add('referrals', 'CUSTOMER', 'POST', '/referrals/apply', {
    token: c,
    body: { referralCode: 'INVALID' },
    expectedStatus: [400, 404],
    skipPassCheck: true,
    remark: 'Expected fail with invalid referral code',
  });

  // ─── FEEDBACK extended ───
  if (ids.feedbackId) {
    add('feedback', 'CUSTOMER', 'GET', `/feedback/${ids.feedbackId}`, { token: c });
    add('feedback', 'CUSTOMER', 'PUT', `/feedback/${ids.feedbackId}`, {
      token: c,
      body: { subject: 'Updated', message: 'Updated msg', category: 'GENERAL' },
    });
    add('feedback', 'ADMIN', 'PATCH', `/feedback/${ids.feedbackId}/moderate`, {
      token: A,
      body: { status: 'APPROVED' },
      expectedStatus: [200, 400],
    });
  }

  // ─── XP admin CRUD ───
  add('xp', 'ADMIN', 'POST', '/xp/admin/level-configs', {
    token: A,
    body: { level: 50, xpRequired: 100, title: 'Test Level' },
    expectedStatus: [200, 201, 400],
  });
  add('xp', 'ADMIN', 'POST', '/xp/admin/rewards', {
    token: A,
    body: { name: 'Test XP Reward', type: 'COINS', value: 5, levelRequired: 1 },
    expectedStatus: [200, 201, 400],
  });
  add('xp', 'CUSTOMER', 'POST', '/xp/rewards/claim-all', { token: c, expectedStatus: [200, 400] });

  // ─── ANCHOR LEVELS claim ───
  add('anchor-levels', 'LISTENER', 'POST', '/anchor-levels/me/rewards/claim-all', { token: l, expectedStatus: [200, 400] });

  // ─── NOTIFICATIONS mark read ───
  add('notifications', 'CUSTOMER', 'PATCH', '/notifications/507f1f77bcf86cd799439011/read', {
    token: c,
    expectedStatus: [200, 404],
    remark: 'May 404 if notification id not found',
  });

  // ─── FOLLOW unfollow cleanup ───
  if (ids.approvedListenerId) {
    add('follows', 'CUSTOMER', 'DELETE', `/follows/${ids.approvedListenerId}`, { token: c, expectedStatus: [200, 204, 404] });
  }
  if (ids.approvedListenerId) {
    add('wishlist', 'CUSTOMER', 'DELETE', `/wishlist/${ids.approvedListenerId}`, { token: c, expectedStatus: [200, 204, 404] });
  }

  // ─── WITHDRAWALS extended ───
  if (ids.bankAccountId) {
    add('withdrawals', 'LISTENER', 'DELETE', `/withdrawals/bank-accounts/${ids.bankAccountId}`, {
      token: l,
      expectedStatus: [200, 204, 404],
    });
  }

  // ─── REVIEWS delete placeholder ───
  add('reviews', 'CUSTOMER', 'DELETE', '/reviews/507f1f77bcf86cd799439011', {
    token: c,
    expectedStatus: [200, 204, 403, 404],
    remark: 'May 404 if review not found',
  });

  // ─── AUTH verify-otp explicit ───
  add('auth', 'PUBLIC', 'POST', '/auth/verify-otp', {
    body: { type: 'CUSTOMER', mobileNumber: customerMobile, otp: '123456', countryCode: '+91' },
    expectedStatus: [200],
    remark: 'Uses same mobile from bootstrap',
  });

  // ─── CHATS messages ───
  if (ids.sessionId) {
    add('chats', 'CUSTOMER', 'GET', `/chats/sessions/${ids.sessionId}/messages?page=1&limit=20`, { token: c });
    add('chats', 'LISTENER', 'GET', `/chats/sessions/${ids.sessionId}/messages?page=1&limit=20`, { token: l });
  }

  // ─── LIVE ROOM detail ───
  if (ids.liveRoomId) {
    add('live-rooms', 'CUSTOMER', 'GET', `/live-rooms/${ids.liveRoomId}`, { token: c });
    add('live-rooms', 'LISTENER', 'POST', `/live-rooms/${ids.liveRoomId}/agora-token`, {
      token: l,
      body: { role: 'PUBLISHER' },
      expectedStatus: [200, 400, 404],
    });
  }

  // ─── DELETE admin resources (cleanup test) ───
  if (ids.languageId) add('languages', 'ADMIN', 'DELETE', `/languages/${ids.languageId}`, { token: A, expectedStatus: [200, 204, 404] });
  if (ids.coinPackId) add('coin-packs', 'ADMIN', 'DELETE', `/coin-packs/${ids.coinPackId}`, { token: A, expectedStatus: [200, 204, 404] });
  if (ids.giftId) add('gifts', 'ADMIN', 'DELETE', `/gifts/${ids.giftId}`, { token: A, expectedStatus: [200, 204, 404] });
  if (ids.stickerId) add('stickers', 'ADMIN', 'DELETE', `/stickers/${ids.stickerId}`, { token: A, expectedStatus: [200, 204, 404] });

  // ─── FEEDBACK by id ───
  if (ids.feedbackId) {
    add('feedback', 'CUSTOMER', 'GET', `/feedback/${ids.feedbackId}`, { token: c });
    add('feedback', 'CUSTOMER', 'PUT', `/feedback/${ids.feedbackId}`, {
      token: c,
      body: { message: 'Updated feedback message', rating: 5 },
    });
    add('feedback', 'ADMIN', 'PATCH', `/feedback/${ids.feedbackId}/moderate`, {
      token: A,
      body: { status: 'RESOLVED' },
      expectedStatus: [200, 400],
    });
  }

  // ─── NOTIFICATIONS delete ───
  add('notifications', 'CUSTOMER', 'DELETE', '/notifications/507f1f77bcf86cd799439011', {
    token: c,
    expectedStatus: [200, 204, 404],
  });

  // ─── XP admin update/delete placeholders ───
  add('xp', 'ADMIN', 'PUT', '/xp/admin/level-configs/507f1f77bcf86cd799439011', {
    token: A,
    body: { level: 1, xpRequired: 100 },
    expectedStatus: [200, 404],
  });
  add('xp', 'ADMIN', 'DELETE', '/xp/admin/rewards/507f1f77bcf86cd799439011', {
    token: A,
    expectedStatus: [200, 204, 404],
  });

  // ─── WITHDRAWALS request ───
  add('withdrawals', 'LISTENER', 'POST', '/withdrawals', {
    token: l,
    body: { coins: 100, bankAccountId: ids.bankAccountId || '507f1f77bcf86cd799439011' },
    expectedStatus: [200, 201, 400],
    remark: 'May fail if insufficient balance or invalid bank account',
  });

  // ─── WEBHOOK (public) ───
  add('wallets', 'PUBLIC', 'POST', '/wallets/payments/webhook', {
    body: {},
    expectedStatus: [400, 401, 500],
    skipPassCheck: true,
    remark: 'Expected fail without Razorpay signature',
  });

  return T;
}

async function setupFixtures(ctx) {
  const A = ADMIN_TOKEN;
  const ids = { ...ctx.ids };

  const lang = await req('POST', '/languages', {
    token: A,
    module: 'setup',
    body: { name: `SetupLang${Date.now()}`, code: `s${Date.now().toString().slice(-4)}` },
    expectedStatus: [200, 201],
  });
  ids.languageId = pickId(lang) || ids.languageId;

  const pack = await req('POST', '/coin-packs', {
    token: A,
    module: 'setup',
    body: { name: `SetupPack${Date.now()}`, coins: 50, price: 49, currency: 'INR', isActive: true },
    expectedStatus: [200, 201],
  });
  ids.coinPackId = pickId(pack) || ids.coinPackId;

  const gift = await req('POST', '/gifts', {
    token: A,
    module: 'setup',
    body: { name: `SetupGift${Date.now()}`, coin: 5, icon: 'https://example.com/g.png', category: 'REGULAR' },
    expectedStatus: [200, 201],
  });
  ids.giftId = pickId(gift) || ids.giftId;

  const cat = await req('POST', '/sticker-categories', {
    token: A,
    module: 'setup',
    body: { name: `SetupCat${Date.now()}`, isActive: true },
    expectedStatus: [200, 201],
  });
  ids.stickerCategoryId = pickId(cat) || ids.stickerCategoryId;

  const listeners = await req('GET', '/listeners?page=1&limit=5', {
    token: ctx.customerToken,
    module: 'setup',
  });
  const listenerList = listeners.returnedData?.data?.docs || listeners.returnedData?.data?.items || listeners.returnedData?.data || [];
  if (Array.isArray(listenerList) && listenerList.length) {
    const approved = listenerList.find((x) => x.kycStatus === 'APPROVED') || listenerList[0];
    ids.approvedListenerId = approved.userId || approved._id || approved.id;
  }

  const sessions = await req('GET', '/chats/sessions?limit=5', {
    token: ctx.customerToken,
    module: 'setup',
  });
  const sessList = sessions.returnedData?.data?.docs || sessions.returnedData?.data || [];
  if (Array.isArray(sessList) && sessList.length) ids.sessionId = sessList[0]._id;

  const rooms = await req('GET', '/live-rooms?page=1&limit=1', {
    token: ctx.customerToken,
    module: 'setup',
  });
  const roomList = rooms.returnedData?.data?.docs || rooms.returnedData?.data || [];
  if (Array.isArray(roomList) && roomList.length) ids.liveRoomId = roomList[0]._id;

  const wallet = await req('GET', '/wallets/me', { token: ctx.customerToken, module: 'setup' });
  ids.walletId = wallet.returnedData?.data?._id;

  const avatars = await req('GET', '/avatars', { token: ctx.customerToken, module: 'setup' });
  const avList = avatars.returnedData?.data || [];
  if (Array.isArray(avList) && avList.length) ids.avatarId = avList[0]._id;

  const companies = await req('GET', '/company', { token: ctx.customerToken, module: 'setup' });
  const coList = companies.returnedData?.data || [];
  if (Array.isArray(coList) && coList.length) ids.companyId = coList[0]._id;

  const feedback = await req('POST', '/feedback', {
    token: ctx.customerToken,
    module: 'setup',
    body: { message: 'Setup feedback', category: 'OTHER', rating: 4 },
    expectedStatus: [200, 201],
  });
  ids.feedbackId = pickId(feedback);

  const bank = await req('POST', '/withdrawals/bank-accounts', {
    token: ctx.listenerToken,
    module: 'setup',
    body: {
      methodType: 'BANK',
      accountHolderName: 'Setup Listener',
      accountNumber: '9876543210',
      ifscCode: 'HDFC0001234',
      bankName: 'HDFC',
    },
    expectedStatus: [200, 201],
  });
  ids.bankAccountId = pickId(bank);

  const sticker = await req('POST', '/stickers', {
    token: A,
    module: 'setup',
    body: {
      name: `SetupStk${Date.now()}`,
      categoryId: ids.stickerCategoryId,
      imageUrl: 'https://example.com/s.png',
      coinCost: 0,
      isActive: true,
    },
    expectedStatus: [200, 201],
  });
  ids.stickerId = pickId(sticker);

  ids.customerId = ctx.customerUser._id;
  ids.listenerId = ctx.listenerUser._id;

  return ids;
}

async function cleanupFixtures(ids) {
  const A = ADMIN_TOKEN;
  const dels = [];
  if (ids.languageId) dels.push(req('DELETE', `/languages/${ids.languageId}`, { token: A, module: 'cleanup', expectedStatus: [200, 204, 404] }));
  if (ids.coinPackId) dels.push(req('DELETE', `/coin-packs/${ids.coinPackId}`, { token: A, module: 'cleanup', expectedStatus: [200, 204, 404] }));
  if (ids.giftId) dels.push(req('DELETE', `/gifts/${ids.giftId}`, { token: A, module: 'cleanup', expectedStatus: [200, 204, 404] }));
  if (ids.stickerCategoryId) dels.push(req('DELETE', `/sticker-categories/${ids.stickerCategoryId}`, { token: A, module: 'cleanup', expectedStatus: [200, 204, 404] }));
  await Promise.all(dels);
}

function serializeData(data) {
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data, null, 0);
    return s.length > 30000 ? `${s.slice(0, 30000)}...[truncated]` : s;
  } catch {
    return String(data);
  }
}

async function writeExcel(results, slowRows, summary) {
  const wb = new ExcelJS.Workbook();
  const all = wb.addWorksheet('AllAPIs');
  all.columns = [
    { header: 'Module', key: 'module', width: 16 },
    { header: 'HTTP Method', key: 'method', width: 12 },
    { header: 'Endpoint', key: 'endpoint', width: 50 },
    { header: 'Role Tested', key: 'role', width: 12 },
    { header: 'Status Code', key: 'statusCode', width: 12 },
    { header: 'Response Time (ms)', key: 'responseTimeMs', width: 18 },
    { header: 'Pass/Fail', key: 'passFail', width: 10 },
    { header: 'Returned Data', key: 'returnedData', width: 80 },
    { header: 'Remarks', key: 'remarks', width: 40 },
  ];
  results.forEach((r) => all.addRow({ ...r, returnedData: serializeData(r.returnedData) }));

  const slow = wb.addWorksheet('SlowAPIs_gt200ms');
  slow.columns = [
    { header: 'Module', key: 'module', width: 16 },
    { header: 'HTTP Method', key: 'method', width: 12 },
    { header: 'Endpoint', key: 'endpoint', width: 50 },
    { header: 'Response Time (ms)', key: 'responseTimeMs', width: 18 },
    { header: 'Possible Reason', key: 'possibleReason', width: 50 },
    { header: 'Recommended Optimization', key: 'optimization', width: 50 },
  ];
  slowRows.forEach((r) => slow.addRow(r));

  const sum = wb.addWorksheet('Summary');
  Object.entries(summary).forEach(([k, v]) => sum.addRow({ metric: k, value: v }));

  const out = path.join(REPORT_DIR, 'full-api-report.xlsx');
  await wb.xlsx.writeFile(out);
  return out;
}

async function main() {
  fs.mkdirSync(RESPONSES_DIR, { recursive: true });

  console.log('Authenticating roles...');
  const customerMobile = `9${Date.now().toString().slice(-9)}`;
  const listenerMobile = `8${(Date.now() + 1).toString().slice(-9)}`;
  const customer = await authOtp('CUSTOMER', customerMobile);
  const listener = await authOtp('LISTENER', listenerMobile);

  let ctx = {
    customerToken: customer.token,
    listenerToken: listener.token,
    customerUser: customer.user,
    listenerUser: listener.user,
    customerMobile,
    listenerMobile,
    ids: {},
  };

  console.log('Setting up fixtures...');
  ctx.ids = await setupFixtures(ctx);

  const tests = buildTests(ctx);
  console.log(`Running ${tests.length} API tests...\n`);

  await req('GET', '/countries', { module: 'warmup' });

  const results = [];
  let idx = 0;
  const responseRecords = [];
  for (const t of tests) {
    const tokenMap = {
      CUSTOMER: ctx.customerToken,
      LISTENER: ctx.listenerToken,
      ADMIN: ADMIN_TOKEN,
      AGENT: AGENT_TOKEN,
      PUBLIC: null,
    };
    const r = await req(t.method, t.endpoint, {
      token: t.token || tokenMap[t.role],
      body: t.body,
      formData: t.formData,
      expectedStatus: t.expectedStatus,
      label: t.label,
      module: t.module,
      role: t.role,
      skipPassCheck: t.skipPassCheck,
      remark: t.remark,
    });
    idx += 1;
    const responseFile = `${String(idx).padStart(3, '0')}-${t.module}-${t.method}-${t.endpoint.replace(/[^\w-]/g, '_').slice(0, 60)}.json`;
    responseRecords.push({ file: responseFile, data: r.returnedData });
    results.push({ ...r, responseFile });
    process.stdout.write(`${r.passFail === 'Pass' ? '✓' : '✗'} [${r.responseTimeMs}ms] ${t.method} ${t.endpoint}\n`);
    await new Promise((res) => setTimeout(res, 15));
  }

  console.log('\nCleaning up fixtures...');
  await cleanupFixtures(ctx.ids);

  for (const rec of responseRecords) {
    fs.writeFileSync(path.join(RESPONSES_DIR, rec.file), JSON.stringify(rec.data, null, 2));
  }

  const passed = results.filter((r) => r.passFail === 'Pass');
  const failed = results.filter((r) => r.passFail === 'Fail');
  const slow = results.filter((r) => r.responseTimeMs > 200);
  const times = results.map((r) => r.responseTimeMs);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const fastest = results.reduce((a, b) => (a.responseTimeMs < b.responseTimeMs ? a : b), results[0]);
  const slowest = results.reduce((a, b) => (a.responseTimeMs > b.responseTimeMs ? a : b), results[0]);

  const slowRows = slow.map((r) => {
    const a = getSlowAnalysis(r.method, r.endpoint);
    return {
      module: r.module,
      method: r.method,
      endpoint: r.endpoint,
      responseTimeMs: r.responseTimeMs,
      possibleReason: a.reason,
      optimization: a.optimization,
    };
  });

  const summary = {
    'Total APIs Tested': results.length,
    'Passed APIs': passed.length,
    'Failed APIs': failed.length,
    'APIs with Response Time > 200 ms': slow.length,
    'Average Response Time (ms)': avg,
    'Fastest API': fastest ? `${fastest.method} ${fastest.endpoint} (${fastest.responseTimeMs}ms)` : 'N/A',
    'Slowest API': slowest ? `${slowest.method} ${slowest.endpoint} (${slowest.responseTimeMs}ms)` : 'N/A',
  };

  const excelPath = await writeExcel(results, slowRows, summary);
  fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify({ summary, failed: failed.map((f) => ({ endpoint: f.endpoint, status: f.statusCode, remarks: f.remarks })) }, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nReport: ${excelPath}`);
  console.log(`JSON responses: ${RESPONSES_DIR}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
