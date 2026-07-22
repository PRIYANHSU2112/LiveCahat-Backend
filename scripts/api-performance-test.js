/**
 * API Performance Test Suite
 * Discovers routes, executes with admin auth, writes Excel + Markdown reports.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'superadmin@livechat.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'SuperPassword123!';
const OUT_DIR = path.resolve(__dirname, '..');
const SLOW_MS = 200;

// ---------------------------------------------------------------------------
// Route inventory (module, method, path template, body, skipDestructive)
// Paths use :id placeholders resolved at runtime from collected IDs.
// ---------------------------------------------------------------------------

/** @type {Array<{module:string, method:string, path:string, body?:any, query?:Record<string,string>, skip?:boolean, note?:string}>} */
const ENDPOINTS = [
  // Auth
  { module: 'auth', method: 'POST', path: '/auth/login', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, note: 'login' },
  { module: 'auth', method: 'POST', path: '/auth/guest-login', body: { deviceId: 'api-perf-test-device' }, note: 'guest login' },
  { module: 'auth', method: 'POST', path: '/auth/link-account', body: {}, skip: true, note: 'needs customer token' },
  { module: 'auth', method: 'POST', path: '/auth/direct-login', body: {}, skip: true, note: 'special flow' },
  { module: 'auth', method: 'POST', path: '/auth/request-otp', body: { mobileNumber: '9999999999', countryCode: '+91' }, skip: true, note: 'OTP - skip' },
  { module: 'auth', method: 'POST', path: '/auth/verify-otp', body: {}, skip: true, note: 'OTP - skip' },

  // Users (admin)
  { module: 'users', method: 'GET', path: '/users/me' },
  { module: 'users', method: 'GET', path: '/users/me/settings' },
  { module: 'users', method: 'PATCH', path: '/users/me/settings', body: { notifications: true } },
  { module: 'users', method: 'GET', path: '/users/stats' },
  { module: 'users', method: 'GET', path: '/users/agent-stats' },
  { module: 'users', method: 'GET', path: '/users/blocked-stats' },
  { module: 'users', method: 'GET', path: '/users/activity/stats' },
  { module: 'users', method: 'GET', path: '/users/activity', query: { page: '1', limit: '10' } },
  { module: 'users', method: 'GET', path: '/users', query: { page: '1', limit: '10', type: 'CUSTOMER' } },
  { module: 'users', method: 'GET', path: '/users', query: { page: '1', limit: '10', type: 'AGENT' } },
  { module: 'users', method: 'GET', path: '/users', query: { page: '1', limit: '10', isBlocked: 'true' } },
  { module: 'users', method: 'GET', path: '/users/:userId' },
  { module: 'users', method: 'GET', path: '/users/export', query: { type: 'CUSTOMER', page: '1', limit: '5' }, note: 'export binary' },
  { module: 'users', method: 'PUT', path: '/users/me', body: { firstName: 'Super' }, note: 'update profile' },
  { module: 'users', method: 'POST', path: '/users/:userId/block', body: { isBlocked: false }, note: 'unblock (safe)' },
  { module: 'users', method: 'DELETE', path: '/users/me', skip: true, note: 'destructive' },
  { module: 'users', method: 'POST', path: '/users/admin', skip: true, note: 'creates admin' },
  { module: 'users', method: 'POST', path: '/users/listener', skip: true, note: 'creates listener' },
  { module: 'users', method: 'POST', path: '/users/agent', skip: true, note: 'creates agent' },

  // Platform settings
  { module: 'platform-settings', method: 'GET', path: '/platform-settings' },
  { module: 'platform-settings', method: 'PUT', path: '/platform-settings', skip: true, note: 'mutates production settings' },

  // Payment gateways
  { module: 'payment-gateways', method: 'GET', path: '/payment-gateways' },
  { module: 'payment-gateways', method: 'GET', path: '/payment-gateways/:gatewayId' },
  { module: 'payment-gateways', method: 'POST', path: '/payment-gateways', skip: true, note: 'creates gateway' },
  { module: 'payment-gateways', method: 'PUT', path: '/payment-gateways/:gatewayId', skip: true },
  { module: 'payment-gateways', method: 'PATCH', path: '/payment-gateways/:gatewayId/default', skip: true },
  { module: 'payment-gateways', method: 'PATCH', path: '/payment-gateways/:gatewayId/status', skip: true },
  { module: 'payment-gateways', method: 'DELETE', path: '/payment-gateways/:gatewayId', skip: true },

  // Countries
  { module: 'countries', method: 'GET', path: '/countries' },
  { module: 'countries', method: 'GET', path: '/countries/admin/stats' },
  { module: 'countries', method: 'GET', path: '/countries/admin', query: { page: '1', limit: '10' } },
  { module: 'countries', method: 'GET', path: '/countries/admin/export', query: { page: '1', limit: '5' } },
  { module: 'countries', method: 'GET', path: '/countries/:countryId' },
  { module: 'countries', method: 'POST', path: '/countries', skip: true },
  { module: 'countries', method: 'PUT', path: '/countries/:countryId', skip: true },
  { module: 'countries', method: 'PATCH', path: '/countries/:countryId/toggle', skip: true },
  { module: 'countries', method: 'DELETE', path: '/countries/:countryId', skip: true },

  // Home / Match (CUSTOMER/LISTENER only)
  { module: 'home', method: 'GET', path: '/home/user-home', skip: true, note: 'CUSTOMER/LISTENER only' },
  { module: 'home', method: 'GET', path: '/home/listener-home', skip: true, note: 'LISTENER only' },
  { module: 'match', method: 'GET', path: '/match/listeners', skip: true, note: 'role-restricted' },
  { module: 'match', method: 'GET', path: '/match/filters', skip: true, note: 'role-restricted' },

  // Agent (AGENT role only — skip under admin token)
  { module: 'agent', method: 'GET', path: '/agent/revenue/summary', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/revenue/graphs', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/revenue/history', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/revenue/history/stats', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/analytics/revenue/summary', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/analytics/revenue/charts', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/analytics/listeners/summary', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/analytics/listeners/charts', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/analytics/retention/summary', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/analytics/retention/charts', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/settlements', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/settlements/stats', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/reports', skip: true, note: 'AGENT only' },
  { module: 'agent', method: 'GET', path: '/agent/dashboard', skip: true, note: 'AGENT only' },

  // Analytics (admin) — mounted at /analytics
  { module: 'analytics', method: 'GET', path: '/analytics/admin/revenue/summary' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/revenue/charts' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/users/summary' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/users/charts' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/listeners/summary' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/listeners/charts' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/sessions/summary' },
  { module: 'analytics', method: 'GET', path: '/analytics/admin/sessions/charts' },

  // Admin dashboard — mounted at /admin
  { module: 'admin-dashboard', method: 'GET', path: '/admin/dashboard/summary' },
  { module: 'admin-dashboard', method: 'GET', path: '/admin/dashboard/charts' },
  { module: 'admin-dashboard', method: 'GET', path: '/admin/dashboard/listeners/busy', query: { page: '1', limit: '10' } },
  { module: 'admin-dashboard', method: 'GET', path: '/admin/dashboard/sessions/chat', query: { page: '1', limit: '10' } },

  // Communications
  { module: 'communications', method: 'GET', path: '/communications/admin/sessions', query: { page: '1', limit: '10' } },
  { module: 'communications', method: 'GET', path: '/communications/admin/sessions/stats' },
  { module: 'communications', method: 'GET', path: '/communications/admin/sessions/live' },
  { module: 'communications', method: 'GET', path: '/communications/admin/sessions/export', query: { page: '1', limit: '5' } },
  { module: 'communications', method: 'GET', path: '/communications/admin/config' },
  { module: 'communications', method: 'PUT', path: '/communications/admin/config', skip: true },

  // Roles / permissions / audit
  { module: 'roles', method: 'GET', path: '/roles/stats' },
  { module: 'roles', method: 'GET', path: '/roles/policies' },
  { module: 'roles', method: 'GET', path: '/roles', query: { page: '1', limit: '20' } },
  { module: 'roles', method: 'GET', path: '/roles/export' },
  { module: 'roles', method: 'GET', path: '/roles/:roleId' },
  { module: 'roles', method: 'GET', path: '/roles/:roleId/matrix' },
  { module: 'roles', method: 'GET', path: '/roles/:roleId/admins', query: { page: '1', limit: '10' } },
  { module: 'roles', method: 'POST', path: '/roles', skip: true },
  { module: 'roles', method: 'PATCH', path: '/roles/:roleId', skip: true },
  { module: 'roles', method: 'DELETE', path: '/roles/:roleId', skip: true },
  { module: 'roles', method: 'PUT', path: '/roles/:roleId/matrix', skip: true },
  { module: 'permissions', method: 'GET', path: '/permissions' },
  { module: 'audit-logs', method: 'GET', path: '/audit-logs', query: { page: '1', limit: '20' } },
  { module: 'audit-logs', method: 'GET', path: '/audit-logs/export', query: { page: '1', limit: '5' } },

  // Listeners
  { module: 'listeners', method: 'GET', path: '/listeners', query: { page: '1', limit: '10' } },
  { module: 'listeners', method: 'GET', path: '/listeners/admin/stats' },
  { module: 'listeners', method: 'GET', path: '/listeners/admin/performance', query: { page: '1', limit: '10' } },
  { module: 'listeners', method: 'GET', path: '/listeners/admin/availability-monitoring', query: { page: '1', limit: '10' } },
  { module: 'listeners', method: 'GET', path: '/listeners/:listenerId' },
  { module: 'listeners', method: 'GET', path: '/listeners/agent', skip: true, note: 'AGENT role only' },
  { module: 'listeners', method: 'GET', path: '/listeners/agent/stats', skip: true, note: 'AGENT role only' },

  // Languages
  { module: 'languages', method: 'GET', path: '/languages', query: { page: '1', limit: '20' } },
  { module: 'languages', method: 'GET', path: '/languages/admin/stats' },
  { module: 'languages', method: 'GET', path: '/languages/admin/export', query: { page: '1', limit: '5' } },
  { module: 'languages', method: 'GET', path: '/languages/:languageId' },
  { module: 'languages', method: 'POST', path: '/languages', skip: true },
  { module: 'languages', method: 'PUT', path: '/languages/:languageId', skip: true },
  { module: 'languages', method: 'PATCH', path: '/languages/:languageId/toggle', skip: true },
  { module: 'languages', method: 'DELETE', path: '/languages/:languageId', skip: true },

  // Coin packs
  { module: 'coin-packs', method: 'GET', path: '/coin-packs' },
  { module: 'coin-packs', method: 'GET', path: '/coin-packs/admin/stats' },
  { module: 'coin-packs', method: 'GET', path: '/coin-packs/admin', query: { page: '1', limit: '10' } },
  { module: 'coin-packs', method: 'GET', path: '/coin-packs/admin/export', query: { page: '1', limit: '5' } },
  { module: 'coin-packs', method: 'GET', path: '/coin-packs/:coinPackId' },
  { module: 'coin-packs', method: 'POST', path: '/coin-packs', skip: true },
  { module: 'coin-packs', method: 'PUT', path: '/coin-packs/:coinPackId', skip: true },
  { module: 'coin-packs', method: 'PATCH', path: '/coin-packs/:coinPackId/toggle', skip: true },
  { module: 'coin-packs', method: 'DELETE', path: '/coin-packs/:coinPackId', skip: true },

  // Wallets
  { module: 'wallets', method: 'GET', path: '/wallets/me' },
  { module: 'wallets', method: 'GET', path: '/wallets/me/coin-transactions', query: { page: '1', limit: '10' } },
  { module: 'wallets', method: 'GET', path: '/wallets/me/payment-transactions', query: { page: '1', limit: '10' } },
  { module: 'wallets', method: 'GET', path: '/wallets/admin/stats' },
  { module: 'wallets', method: 'GET', path: '/wallets/admin', query: { page: '1', limit: '10' } },
  { module: 'wallets', method: 'GET', path: '/wallets/admin/coin-transactions', query: { page: '1', limit: '10' } },
  { module: 'wallets', method: 'GET', path: '/wallets/admin/payment-transactions', query: { page: '1', limit: '10' } },
  { module: 'wallets', method: 'GET', path: '/wallets/admin/export' },
  { module: 'wallets', method: 'GET', path: '/wallets/admin/:walletId' },
  { module: 'wallets', method: 'GET', path: '/wallets/admin/user/:userId' },
  { module: 'wallets', method: 'POST', path: '/wallets/payments/create-order', body: { coinPackId: 'PLACEHOLDER' }, skip: true, note: 'needs valid pack' },
  { module: 'wallets', method: 'POST', path: '/wallets/payments/webhook', skip: true },
  { module: 'wallets', method: 'POST', path: '/wallets/admin/user/:userId/credit-debit', skip: true },
  { module: 'wallets', method: 'PUT', path: '/wallets/admin/:walletId/status', skip: true },

  // Follows
  { module: 'follows', method: 'GET', path: '/follows/following', query: { page: '1', limit: '10' } },
  { module: 'follows', method: 'GET', path: '/follows/favorites', query: { page: '1', limit: '10' } },
  { module: 'follows', method: 'GET', path: '/follows/counts/:userId' },
  { module: 'follows', method: 'POST', path: '/follows/:listenerId', skip: true, note: 'CUSTOMER only' },

  // Company
  { module: 'company', method: 'GET', path: '/company' },
  { module: 'company', method: 'GET', path: '/company/admin/profile' },
  { module: 'company', method: 'GET', path: '/company/admin/stats' },
  { module: 'company', method: 'PUT', path: '/company/admin/profile', skip: true },

  // Gifts
  { module: 'gifts', method: 'GET', path: '/gifts', query: { page: '1', limit: '10' } },
  { module: 'gifts', method: 'GET', path: '/gifts/admin', query: { page: '1', limit: '10' } },
  { module: 'gifts', method: 'GET', path: '/gifts/admin/stats' },
  { module: 'gifts', method: 'GET', path: '/gifts/admin/analytics' },
  { module: 'gifts', method: 'GET', path: '/gifts/admin/export', query: { page: '1', limit: '5' } },
  { module: 'gifts', method: 'GET', path: '/gifts/:giftId' },
  { module: 'gifts', method: 'GET', path: '/gifts/history/sent', query: { page: '1', limit: '10' } },
  { module: 'gifts', method: 'GET', path: '/gifts/history/received', query: { page: '1', limit: '10' } },
  { module: 'gifts', method: 'POST', path: '/gifts', skip: true },
  { module: 'gifts', method: 'PUT', path: '/gifts/:giftId', skip: true },
  { module: 'gifts', method: 'DELETE', path: '/gifts/:giftId', skip: true },
  { module: 'gifts', method: 'POST', path: '/gifts/send', skip: true },

  // Chats / Calls / Live / Reviews
  { module: 'chats', method: 'GET', path: '/chats/conversations', query: { page: '1', limit: '10' } },
  { module: 'chats', method: 'GET', path: '/chats/sessions' },
  { module: 'calls', method: 'POST', path: '/calls/initiate', skip: true, note: 'needs live peer' },
  { module: 'calls', method: 'GET', path: '/calls/token/:sessionId', skip: true },
  { module: 'live-rooms', method: 'GET', path: '/live-rooms', query: { page: '1', limit: '10' } },
  { module: 'reviews', method: 'GET', path: '/reviews/listeners/:listenerId', query: { page: '1', limit: '10' } },
  { module: 'reviews', method: 'POST', path: '/reviews/listeners/:listenerId', skip: true },
  { module: 'banners', method: 'GET', path: '/banners' },
  { module: 'banners', method: 'GET', path: '/banners/all' },
  { module: 'banners', method: 'GET', path: '/banners/admin/stats' },
  { module: 'banners', method: 'GET', path: '/banners/export' },
  { module: 'banners', method: 'GET', path: '/banners/:bannerId' },
  { module: 'banners', method: 'POST', path: '/banners', skip: true },
  { module: 'banners', method: 'PUT', path: '/banners/:bannerId', skip: true },
  { module: 'banners', method: 'DELETE', path: '/banners/:bannerId', skip: true },
  { module: 'banners', method: 'PATCH', path: '/banners/:bannerId/toggle-active', skip: true },

  // Wishlist
  { module: 'wishlist', method: 'GET', path: '/wishlist', query: { page: '1', limit: '10' } },

  // Daily rewards
  { module: 'daily-rewards', method: 'GET', path: '/daily-rewards/status' },
  { module: 'daily-rewards', method: 'GET', path: '/daily-rewards/admin/stats' },
  { module: 'daily-rewards', method: 'GET', path: '/daily-rewards/admin/config' },
  { module: 'daily-rewards', method: 'GET', path: '/daily-rewards/admin/claims', query: { page: '1', limit: '10' } },
  { module: 'daily-rewards', method: 'PUT', path: '/daily-rewards/admin/config', skip: true },
  { module: 'daily-rewards', method: 'POST', path: '/daily-rewards/claim', skip: true },

  // Avatars
  { module: 'avatars', method: 'GET', path: '/avatars' },
  { module: 'avatars', method: 'GET', path: '/avatars/admin', query: { page: '1', limit: '10' } },
  { module: 'avatars', method: 'GET', path: '/avatars/admin/stats' },
  { module: 'avatars', method: 'GET', path: '/avatars/admin/export', query: { page: '1', limit: '5' } },
  { module: 'avatars', method: 'POST', path: '/avatars/admin', skip: true },
  { module: 'avatars', method: 'PUT', path: '/avatars/admin/:avatarId', skip: true },
  { module: 'avatars', method: 'DELETE', path: '/avatars/admin/:avatarId', skip: true },

  // Stickers / categories
  { module: 'sticker-categories', method: 'GET', path: '/sticker-categories' },
  { module: 'sticker-categories', method: 'GET', path: '/sticker-categories/admin/stats' },
  { module: 'sticker-categories', method: 'POST', path: '/sticker-categories', skip: true },
  { module: 'stickers', method: 'GET', path: '/stickers', query: { page: '1', limit: '10' } },
  { module: 'stickers', method: 'GET', path: '/stickers/admin/stats' },
  { module: 'stickers', method: 'GET', path: '/stickers/admin/export', query: { page: '1', limit: '5' } },
  { module: 'stickers', method: 'GET', path: '/stickers/:stickerId' },
  { module: 'stickers', method: 'POST', path: '/stickers', skip: true },
  { module: 'stickers', method: 'PUT', path: '/stickers/:stickerId', skip: true },
  { module: 'stickers', method: 'DELETE', path: '/stickers/:stickerId', skip: true },

  // Feedback
  { module: 'feedback', method: 'GET', path: '/feedback/me', query: { page: '1', limit: '10' } },
  { module: 'feedback', method: 'GET', path: '/feedback/admin', query: { page: '1', limit: '10' } },
  { module: 'feedback', method: 'GET', path: '/feedback/admin/stats' },
  { module: 'feedback', method: 'GET', path: '/feedback/admin/export', query: { page: '1', limit: '5' } },
  { module: 'feedback', method: 'GET', path: '/feedback/admin/:feedbackId' },
  { module: 'feedback', method: 'POST', path: '/feedback', body: { category: 'OTHER', message: 'API performance test feedback', rating: 5 } },
  { module: 'feedback', method: 'PATCH', path: '/feedback/admin/:feedbackId', body: { status: 'IN_REVIEW' }, note: 'moderate' },

  // Reports
  { module: 'reports', method: 'GET', path: '/reports/reasons' },
  { module: 'reports', method: 'GET', path: '/reports/reasons/admin', query: { page: '1', limit: '20' } },
  { module: 'reports', method: 'GET', path: '/reports/stats' },
  { module: 'reports', method: 'GET', path: '/reports', query: { page: '1', limit: '10' } },
  { module: 'reports', method: 'GET', path: '/reports/export', query: { page: '1', limit: '5' } },
  { module: 'reports', method: 'GET', path: '/reports/:reportId' },
  { module: 'reports', method: 'POST', path: '/reports/reasons', skip: true },
  { module: 'reports', method: 'PATCH', path: '/reports/reasons/:reasonId', skip: true },
  { module: 'reports', method: 'DELETE', path: '/reports/reasons/:reasonId', skip: true },
  { module: 'reports', method: 'POST', path: '/reports', skip: true, note: 'CUSTOMER/LISTENER only' },

  // Referrals
  { module: 'referrals', method: 'GET', path: '/referrals/details' },
  { module: 'referrals', method: 'GET', path: '/referrals/admin/stats' },
  { module: 'referrals', method: 'GET', path: '/referrals/admin/referrals', query: { page: '1', limit: '10' } },
  { module: 'referrals', method: 'GET', path: '/referrals/admin/config' },
  { module: 'referrals', method: 'GET', path: '/referrals/admin/referrals/export', query: { page: '1', limit: '5' } },
  { module: 'referrals', method: 'PUT', path: '/referrals/admin/config', skip: true },
  { module: 'referrals', method: 'POST', path: '/referrals/apply', skip: true },

  // Withdrawals
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/config' },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/me', query: { page: '1', limit: '10' } },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/me/stats' },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/bank-accounts' },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/admin', query: { page: '1', limit: '10' } },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/admin/stats' },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/admin/settlements', query: { page: '1', limit: '10' } },
  { module: 'withdrawals', method: 'GET', path: '/withdrawals/admin/export', query: { page: '1', limit: '5' } },
  { module: 'withdrawals', method: 'PUT', path: '/withdrawals/admin/config', skip: true },
  { module: 'withdrawals', method: 'POST', path: '/withdrawals', skip: true },
  { module: 'withdrawals', method: 'POST', path: '/withdrawals/bank-accounts', skip: true },

  // Anchor levels
  { module: 'anchor-levels', method: 'GET', path: '/anchor-levels' },
  { module: 'anchor-levels', method: 'GET', path: '/anchor-levels/admin', query: { page: '1', limit: '10' } },
  { module: 'anchor-levels', method: 'GET', path: '/anchor-levels/admin/stats' },
  { module: 'anchor-levels', method: 'GET', path: '/anchor-levels/admin/claims', query: { page: '1', limit: '10' } },
  { module: 'anchor-levels', method: 'POST', path: '/anchor-levels', skip: true },
  { module: 'anchor-levels', method: 'PUT', path: '/anchor-levels/:anchorLevelId', skip: true },
  { module: 'anchor-levels', method: 'DELETE', path: '/anchor-levels/:anchorLevelId', skip: true },

  // Notifications
  { module: 'notifications', method: 'GET', path: '/notifications', query: { page: '1', limit: '10' } },
  { module: 'notifications', method: 'GET', path: '/notifications/stats' },
  { module: 'notifications', method: 'GET', path: '/notifications/admin', query: { page: '1', limit: '10' } },
  { module: 'notifications', method: 'GET', path: '/notifications/admin/stats' },
  { module: 'notifications', method: 'POST', path: '/notifications/admin/send', skip: true },
  { module: 'notifications', method: 'PATCH', path: '/notifications/read-all', body: {} },

  // XP
  { module: 'xp', method: 'GET', path: '/xp/profile' },
  { module: 'xp', method: 'GET', path: '/xp/history' },
  { module: 'xp', method: 'GET', path: '/xp/leaderboard' },
  { module: 'xp', method: 'GET', path: '/xp/admin/stats' },
  { module: 'xp', method: 'GET', path: '/xp/admin/level-configs' },
  { module: 'xp', method: 'GET', path: '/xp/admin/xp-actions' },
  { module: 'xp', method: 'GET', path: '/xp/admin/transactions', query: { page: '1', limit: '10' } },
  { module: 'xp', method: 'GET', path: '/xp/admin/reward-claims', query: { page: '1', limit: '10' } },
  { module: 'xp', method: 'GET', path: '/xp/admin/rewards' },
  { module: 'xp', method: 'POST', path: '/xp/admin/grant', skip: true },
  { module: 'xp', method: 'PUT', path: '/xp/admin/level-configs/:id', skip: true },
  { module: 'xp', method: 'PUT', path: '/xp/admin/xp-actions/:action', skip: true },

  // Search
  { module: 'search', method: 'GET', path: '/search/listeners', query: { q: 'a', page: '1', limit: '10' } },
  { module: 'search', method: 'GET', path: '/search/admin', query: { q: 'a', page: '1', limit: '10' } },
  { module: 'search', method: 'GET', path: '/search/agent/listeners', skip: true, note: 'AGENT only' },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function truncate(value, max = 4000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length} chars]` : s;
}

function colorForMs(ms) {
  if (ms < 0) return 'FF9CA3AF'; // gray skip
  if (ms < 100) return 'FF22C55E'; // green
  if (ms <= 200) return 'FFEAB308'; // yellow
  if (ms <= 500) return 'FFF97316'; // orange
  return 'FFEF4444'; // red
}

function speedLabel(ms) {
  if (ms < 0) return 'SKIPPED';
  if (ms < 100) return 'GREEN <100ms';
  if (ms <= 200) return 'YELLOW 100-200ms';
  if (ms <= 500) return 'ORANGE 200-500ms';
  return 'RED >500ms';
}

async function request(method, urlPath, { token, body, query } = {}) {
  const url = new URL(`${BASE_URL}${urlPath}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const start = performance.now();
  let statusCode = 0;
  let responseBody = '';
  let responseJson = null;
  let error = null;

  try {
    const res = await fetch(url, { method, headers, body: payload });
    statusCode = res.status;
    const text = await res.text();
    responseBody = text;
    try {
      responseJson = JSON.parse(text);
    } catch {
      responseJson = null;
    }
  } catch (err) {
    error = err.message;
    statusCode = 0;
    responseBody = err.message;
  }

  const ms = Math.round(performance.now() - start);
  return { statusCode, ms, responseBody, responseJson, error, url: url.toString() };
}

function pickId(doc) {
  const id = doc?._id ?? doc?.id ?? null;
  if (id == null || id === 'null' || id === 'undefined') return null;
  return String(id);
}

function firstDoc(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  if (Array.isArray(data.docs)) return data.docs[0] ?? null;
  if (Array.isArray(data.data)) return data.data[0] ?? null;
  return data;
}

function analyzeSlow(row) {
  const endpoint = `${row.method} ${row.endpoint}`;
  const ms = row.responseTimeMs;
  const moduleHints = {
    analytics: {
      reason: 'Heavy aggregation over sessions/transactions for charts and summaries',
      rootCause: 'Mongo aggregation pipelines without sufficient compound indexes; may scan large collections',
      suggestions: 'Add compound indexes on (createdAt, type); precompute daily rollups; cache charts in Redis 30–60s',
      estimated: Math.max(80, Math.round(ms * 0.35)),
    },
    'admin-dashboard': {
      reason: 'Dashboard fan-out: multiple collections + live pulse',
      rootCause: 'Parallel aggregations / uncached multi-query on each load',
      suggestions: 'Warm Redis cache for summary; use SettingsRuntime-style memory cache; limit activity feed fields',
      estimated: Math.max(90, Math.round(ms * 0.4)),
    },
    communications: {
      reason: 'Session history listing with filters and stats',
      rootCause: 'Large session collection + populate/lookup of participants',
      suggestions: 'Index (status, startedAt); project only needed fields; paginate tightly; cache monitoring snapshot',
      estimated: Math.max(100, Math.round(ms * 0.4)),
    },
    listeners: {
      reason: 'Listener list/performance joins user + wallet/stats',
      rootCause: 'Aggregation $lookup / populate across users and listener profiles',
      suggestions: 'Ensure indexes on kycStatus, userId; denormalize key stats; Redis list cache 30s',
      estimated: Math.max(80, Math.round(ms * 0.4)),
    },
    wallets: {
      reason: 'Wallet admin list or transaction history',
      rootCause: 'Large coin/payment transaction collections; sorting without covering indexes',
      suggestions: 'Index (userId, createdAt); cursor pagination; avoid full count when possible',
      estimated: Math.max(90, Math.round(ms * 0.4)),
    },
    search: {
      reason: 'Text/regex search across users and listeners',
      rootCause: 'Case-insensitive $regex without text index; multi-collection fan-out',
      suggestions: 'Atlas Search or text indexes; limit fields; debounce client; cache popular queries',
      estimated: Math.max(70, Math.round(ms * 0.35)),
    },
    gifts: {
      reason: 'Gift analytics / admin listing',
      rootCause: 'Aggregation over gift send history; possible N+1 or uncached stats',
      suggestions: 'Pre-aggregate daily gift stats; index giftId+createdAt; Redis cache analytics',
      estimated: Math.max(80, Math.round(ms * 0.4)),
    },
    users: {
      reason: 'User list/stats with filters',
      rootCause: 'Paginated aggregation + wallet lookup; cache version miss',
      suggestions: 'Keep Redis list cache warm; index (type, isBlocked, createdAt); lean projections',
      estimated: Math.max(70, Math.round(ms * 0.4)),
    },
    agent: {
      reason: 'Agent analytics / revenue charts',
      rootCause: 'Period aggregations over commission/settlement data',
      suggestions: 'Materialized period summaries; Redis cache by period key',
      estimated: Math.max(90, Math.round(ms * 0.4)),
    },
    withdrawals: {
      reason: 'Admin withdrawal/settlement listing',
      rootCause: 'Populate user/bank + status filters on large collection',
      suggestions: 'Index (status, createdAt); lean queries; cache stats separately',
      estimated: Math.max(80, Math.round(ms * 0.4)),
    },
    reports: {
      reason: 'Reports queue with reasons and populate',
      rootCause: 'Populate reporter/target + reason labels; stats facet',
      suggestions: 'Index status+createdAt; cache stats 30s; select lean fields',
      estimated: Math.max(70, Math.round(ms * 0.4)),
    },
    export: {
      reason: 'Excel/CSV export generation',
      rootCause: 'Large payload serialization and ExcelJS workbook build',
      suggestions: 'Stream export; limit max rows; async job + download link',
      estimated: Math.max(150, Math.round(ms * 0.5)),
    },
  };

  const isExport = row.endpoint.includes('/export');
  const hint =
    (isExport && moduleHints.export) ||
    moduleHints[row.module] || {
      reason: 'Server processing exceeded 200ms threshold',
      rootCause: 'Likely DB query/aggregation, remote I/O, or cold cache miss',
      suggestions: 'Profile with Mongo explain(); add indexes; cache hot reads; reduce payload size',
      estimated: Math.max(80, Math.round(ms * 0.45)),
    };

  return {
    endpoint,
    currentResponseTime: ms,
    reason: hint.reason,
    rootCause: hint.rootCause,
    suggestions: hint.suggestions,
    estimatedAfterOptimization: hint.estimated,
  };
}

function resolvePath(template, ids) {
  return template
    .replace(':userId', ids.userId || '000000000000000000000000')
    .replace(':gatewayId', ids.gatewayId || '000000000000000000000000')
    .replace(':countryId', ids.countryId || '000000000000000000000000')
    .replace(':roleId', ids.roleId || '000000000000000000000000')
    .replace(':listenerId', ids.listenerId || '000000000000000000000000')
    .replace(':languageId', ids.languageId || '000000000000000000000000')
    .replace(':coinPackId', ids.coinPackId || '000000000000000000000000')
    .replace(':walletId', ids.walletId || '000000000000000000000000')
    .replace(':giftId', ids.giftId || '000000000000000000000000')
    .replace(':bannerId', ids.bannerId || '000000000000000000000000')
    .replace(':avatarId', ids.avatarId || '000000000000000000000000')
    .replace(':stickerId', ids.stickerId || '000000000000000000000000')
    .replace(':feedbackId', ids.feedbackId || '000000000000000000000000')
    .replace(':reportId', ids.reportId || '000000000000000000000000')
    .replace(':reasonId', ids.reasonId || '000000000000000000000000')
    .replace(':anchorLevelId', ids.anchorLevelId || '000000000000000000000000')
    .replace(/:([A-Za-z]+)/g, '000000000000000000000000');
}

function collectIds(ids, pathTemplate, responseJson) {
  const data = responseJson?.data ?? responseJson;
  const doc = firstDoc(data);
  const id = pickId(doc);
  if (!id) return;

  if (pathTemplate.includes('/users') && !pathTemplate.includes('/me')) ids.userId ||= String(id);
  if (pathTemplate.includes('/payment-gateways')) ids.gatewayId ||= String(id);
  if (pathTemplate.includes('/countries')) ids.countryId ||= String(id);
  if (pathTemplate.includes('/roles') && !pathTemplate.includes('policies')) ids.roleId ||= String(id);
  if (pathTemplate.includes('/listeners')) ids.listenerId ||= String(id);
  if (pathTemplate.includes('/languages')) ids.languageId ||= String(id);
  if (pathTemplate.includes('/coin-packs')) ids.coinPackId ||= String(id);
  if (pathTemplate.includes('/wallets/admin') && !pathTemplate.includes('transactions')) ids.walletId ||= String(id);
  if (pathTemplate.includes('/gifts')) ids.giftId ||= String(id);
  if (pathTemplate.includes('/banners')) ids.bannerId ||= String(id);
  if (pathTemplate.includes('/avatars')) ids.avatarId ||= String(id);
  if (pathTemplate.includes('/stickers') && !pathTemplate.includes('categories')) ids.stickerId ||= String(id);
  if (pathTemplate.includes('/feedback')) ids.feedbackId ||= String(id);
  if (pathTemplate.includes('/reports') && !pathTemplate.includes('reasons')) ids.reportId ||= String(id);
  if (pathTemplate.includes('/reports/reasons')) ids.reasonId ||= String(id);
  if (pathTemplate.includes('/anchor-levels')) ids.anchorLevelId ||= String(id);

  // Prefer nested user id on listener docs
  if (doc?.userId) ids.userId ||= String(pickId(doc.userId) || doc.userId);
  if (doc?.user?._id) ids.userId ||= String(doc.user._id);
}

function isPass(statusCode, method) {
  if (statusCode === 0) return false;
  if (statusCode >= 200 && statusCode < 300) return true;
  // Expected auth/role denials still "executed" but mark fail for functional pass
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Endpoints catalogued: ${ENDPOINTS.length}`);

  // Login
  const login = await request('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = login.responseJson?.data?.accessToken || login.responseJson?.data?.token;
  if (!token) {
    console.error('Admin login failed:', truncate(login.responseBody, 500));
    process.exit(1);
  }
  console.log('Admin authenticated.');

  const ids = {
    userId: login.responseJson?.data?.user?._id || login.responseJson?.data?.user?.id || null,
  };

  // Seed IDs from a few list endpoints first
  const seedCalls = [
    ['GET', '/users', { type: 'CUSTOMER', page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.userId = String(pickId(x)); }],
    ['GET', '/roles', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.roleId = String(pickId(x)); }],
    ['GET', '/listeners', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.listenerId = String(pickId(x)); }],
    ['GET', '/countries/admin', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.countryId = String(pickId(x)); }],
    ['GET', '/languages', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.languageId = String(pickId(x)); }],
    ['GET', '/coin-packs', null, (d) => { const x = firstDoc(d?.data); if (x) ids.coinPackId = String(pickId(x)); }],
    ['GET', '/gifts', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.giftId = String(pickId(x)); }],
    ['GET', '/banners/all', null, (d) => { const x = firstDoc(d?.data); if (x) ids.bannerId = String(pickId(x)); }],
    ['GET', '/avatars/admin', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.avatarId = String(pickId(x)); }],
    ['GET', '/stickers', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.stickerId = String(pickId(x)); }],
    ['GET', '/wallets/admin', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.walletId = String(pickId(x)); }],
    ['GET', '/payment-gateways', null, (d) => { const x = firstDoc(d?.data); if (x) ids.gatewayId = String(pickId(x)); }],
    ['GET', '/feedback/admin', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.feedbackId = String(pickId(x)); }],
    ['GET', '/reports', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.reportId = String(pickId(x)); }],
    ['GET', '/reports/reasons/admin', { page: '1', limit: '1' }, (d) => { const x = firstDoc(d?.data); if (x) ids.reasonId = String(pickId(x)); }],
    ['GET', '/anchor-levels', null, (d) => { const x = firstDoc(d?.data); if (x) ids.anchorLevelId = String(pickId(x)); }],
  ];

  for (const [method, p, query, setter] of seedCalls) {
    const r = await request(method, p, { token, query });
    try { setter(r.responseJson); } catch { /* ignore */ }
  }
  console.log('Seeded IDs:', ids);

  const results = [];

  for (let i = 0; i < ENDPOINTS.length; i++) {
    const ep = ENDPOINTS[i];
    const resolved = resolvePath(ep.path, ids);

    if (ep.skip) {
      results.push({
        module: ep.module,
        endpoint: resolved,
        method: ep.method,
        statusCode: 'SKIPPED',
        responseTimeMs: -1,
        requestBody: truncate(ep.body ?? ep.query ?? ''),
        responseBody: ep.note || 'Skipped (destructive/special)',
        passFail: 'SKIP',
        speedBand: 'SKIPPED',
        note: ep.note || '',
      });
      continue;
    }

    // Use login response for the login endpoint itself without double-hitting if desired
    const res = await request(ep.method, resolved, {
      token: ep.path === '/auth/login' || ep.path === '/auth/guest' ? undefined : token,
      body: ep.body,
      query: ep.query,
    });

    collectIds(ids, ep.path, res.responseJson);

    const pass = isPass(res.statusCode, ep.method);
    results.push({
      module: ep.module,
      endpoint: resolved,
      method: ep.method,
      statusCode: res.statusCode,
      responseTimeMs: res.ms,
      requestBody: truncate(ep.body ?? ep.query ?? ''),
      responseBody: truncate(res.responseBody),
      passFail: pass ? 'PASS' : 'FAIL',
      speedBand: speedLabel(res.ms),
      note: ep.note || '',
      url: res.url,
    });

    if ((i + 1) % 25 === 0) console.log(`Progress: ${i + 1}/${ENDPOINTS.length}`);
  }

  const executed = results.filter((r) => r.passFail !== 'SKIP');
  const passed = executed.filter((r) => r.passFail === 'PASS');
  const failed = results.filter((r) => r.passFail === 'FAIL');
  const slow = executed.filter((r) => r.responseTimeMs > SLOW_MS);
  const slowAnalysis = slow.map(analyzeSlow);

  // ---- Excel ----
  const wb = new ExcelJS.Workbook();
  wb.creator = 'API Performance Suite';
  wb.created = new Date();

  const summary = wb.addWorksheet('API Summary');
  summary.columns = [
    { header: 'Module', key: 'module', width: 18 },
    { header: 'Endpoint', key: 'endpoint', width: 55 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'Status Code', key: 'statusCode', width: 12 },
    { header: 'Response Time (ms)', key: 'responseTimeMs', width: 18 },
    { header: 'Speed Band', key: 'speedBand', width: 18 },
    { header: 'Pass/Fail', key: 'passFail', width: 10 },
    { header: 'Notes', key: 'note', width: 28 },
  ];
  results.forEach((r) => {
    const row = summary.addRow(r);
    const cell = row.getCell('responseTimeMs');
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorForMs(Number(r.responseTimeMs)) },
    };
    if (r.passFail === 'FAIL') {
      row.getCell('passFail').font = { color: { argb: 'FFDC2626' }, bold: true };
    } else if (r.passFail === 'PASS') {
      row.getCell('passFail').font = { color: { argb: 'FF16A34A' }, bold: true };
    }
  });
  styleHeader(summary);

  const reqSheet = wb.addWorksheet('Request Data');
  reqSheet.columns = [
    { header: 'Module', key: 'module', width: 16 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'Endpoint', key: 'endpoint', width: 55 },
    { header: 'Request Body / Query', key: 'requestBody', width: 80 },
  ];
  results.forEach((r) => reqSheet.addRow(r));
  styleHeader(reqSheet);

  const resSheet = wb.addWorksheet('Response Data');
  resSheet.columns = [
    { header: 'Module', key: 'module', width: 16 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'Endpoint', key: 'endpoint', width: 55 },
    { header: 'Status Code', key: 'statusCode', width: 12 },
    { header: 'Response Time (ms)', key: 'responseTimeMs', width: 18 },
    { header: 'Response Body', key: 'responseBody', width: 100 },
  ];
  results.forEach((r) => {
    const row = resSheet.addRow(r);
    row.getCell('responseTimeMs').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorForMs(Number(r.responseTimeMs)) },
    };
  });
  styleHeader(resSheet);

  const slowSheet = wb.addWorksheet('Slow APIs (>200 ms)');
  slowSheet.columns = [
    { header: 'Endpoint', key: 'endpoint', width: 60 },
    { header: 'Current Response Time (ms)', key: 'currentResponseTime', width: 22 },
    { header: 'Reason for Slowness', key: 'reason', width: 45 },
    { header: 'Root Cause', key: 'rootCause', width: 50 },
    { header: 'Optimization Suggestions', key: 'suggestions', width: 55 },
    { header: 'Est. Time After Opt (ms)', key: 'estimatedAfterOptimization', width: 22 },
  ];
  slowAnalysis.forEach((s) => {
    const row = slowSheet.addRow(s);
    row.getCell('currentResponseTime').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorForMs(s.currentResponseTime) },
    };
  });
  styleHeader(slowSheet);

  const optSheet = wb.addWorksheet('Optimization Report');
  optSheet.columns = slowSheet.columns;
  slowAnalysis.forEach((s) => optSheet.addRow(s));
  styleHeader(optSheet);

  const failSheet = wb.addWorksheet('Failed APIs');
  failSheet.columns = [
    { header: 'Module', key: 'module', width: 16 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'Endpoint', key: 'endpoint', width: 55 },
    { header: 'Status Code', key: 'statusCode', width: 12 },
    { header: 'Response Time (ms)', key: 'responseTimeMs', width: 18 },
    { header: 'Request', key: 'requestBody', width: 40 },
    { header: 'Response', key: 'responseBody', width: 80 },
  ];
  failed.forEach((r) => failSheet.addRow(r));
  styleHeader(failSheet);

  const overview = wb.addWorksheet('Overview', { state: 'visible' });
  overview.getCell('A1').value = 'API Performance Report';
  overview.getCell('A1').font = { bold: true, size: 16 };
  overview.getCell('A3').value = 'Generated At';
  overview.getCell('B3').value = new Date().toISOString();
  overview.getCell('A4').value = 'Base URL';
  overview.getCell('B4').value = BASE_URL;
  overview.getCell('A5').value = 'Total Catalogued';
  overview.getCell('B5').value = results.length;
  overview.getCell('A6').value = 'Executed';
  overview.getCell('B6').value = executed.length;
  overview.getCell('A7').value = 'Passed';
  overview.getCell('B7').value = passed.length;
  overview.getCell('A8').value = 'Failed';
  overview.getCell('B8').value = failed.length;
  overview.getCell('A9').value = 'Skipped';
  overview.getCell('B9').value = results.filter((r) => r.passFail === 'SKIP').length;
  overview.getCell('A10').value = 'Slow (>200ms)';
  overview.getCell('B10').value = slow.length;
  overview.getCell('A11').value = 'Avg Response (ms)';
  overview.getCell('B11').value =
    executed.length > 0
      ? Math.round(executed.reduce((a, r) => a + r.responseTimeMs, 0) / executed.length)
      : 0;
  overview.getCell('A13').value = 'Color Legend';
  overview.getCell('A14').value = '<100 ms';
  overview.getCell('A14').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22C55E' } };
  overview.getCell('A15').value = '100–200 ms';
  overview.getCell('A15').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAB308' } };
  overview.getCell('A16').value = '200–500 ms';
  overview.getCell('A16').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
  overview.getCell('A17').value = '>500 ms';
  overview.getCell('A17').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } };

  // Move overview first
  wb.views = [{ activeTab: 0 }];

  // ---- Markdown summaries (written before xlsx so a locked Excel file cannot drop reports) ----
  const avg =
    executed.length > 0
      ? Math.round(executed.reduce((a, r) => a + r.responseTimeMs, 0) / executed.length)
      : 0;

  const byModule = {};
  for (const r of executed) {
    byModule[r.module] ||= { total: 0, pass: 0, fail: 0, slow: 0, sumMs: 0 };
    byModule[r.module].total += 1;
    byModule[r.module].sumMs += r.responseTimeMs;
    if (r.passFail === 'PASS') byModule[r.module].pass += 1;
    else byModule[r.module].fail += 1;
    if (r.responseTimeMs > SLOW_MS) byModule[r.module].slow += 1;
  }

  const summaryMd = `# API Performance Summary

**Generated:** ${new Date().toISOString()}  
**Base URL:** \`${BASE_URL}\`  
**Auth:** Super Admin (\`${ADMIN_EMAIL}\`)

## Totals

| Metric | Count |
|--------|------:|
| Catalogued endpoints | ${results.length} |
| Executed | ${executed.length} |
| Passed | ${passed.length} |
| Failed | ${failed.length} |
| Skipped (destructive/special) | ${results.filter((r) => r.passFail === 'SKIP').length} |
| Slow (>200 ms) | ${slow.length} |
| Average response time | ${avg} ms |

## Speed bands (executed)

| Band | Count |
|------|------:|
| 🟢 <100 ms | ${executed.filter((r) => r.responseTimeMs < 100).length} |
| 🟡 100–200 ms | ${executed.filter((r) => r.responseTimeMs >= 100 && r.responseTimeMs <= 200).length} |
| 🟠 200–500 ms | ${executed.filter((r) => r.responseTimeMs > 200 && r.responseTimeMs <= 500).length} |
| 🔴 >500 ms | ${executed.filter((r) => r.responseTimeMs > 500).length} |

## By module

| Module | Executed | Pass | Fail | Slow | Avg ms |
|--------|--------:|-----:|-----:|-----:|-------:|
${Object.entries(byModule)
  .sort((a, b) => b[1].sumMs / b[1].total - a[1].sumMs / a[1].total)
  .map(
    ([m, s]) =>
      `| ${m} | ${s.total} | ${s.pass} | ${s.fail} | ${s.slow} | ${Math.round(s.sumMs / s.total)} |`,
  )
  .join('\n')}

## Top 15 slowest

| Method | Endpoint | ms | Status |
|--------|----------|---:|-------:|
${[...executed]
  .sort((a, b) => b.responseTimeMs - a.responseTimeMs)
  .slice(0, 15)
  .map((r) => `| ${r.method} | \`${r.endpoint}\` | ${r.responseTimeMs} | ${r.statusCode} |`)
  .join('\n')}

## Failed APIs (sample)

${
  failed.length === 0
    ? '_None_'
    : failed
        .slice(0, 25)
        .map((r) => `- **${r.method}** \`${r.endpoint}\` → ${r.statusCode}`)
        .join('\n')
}

## Artifacts

- \`api-performance-report.xlsx\`
- \`optimization-report.md\`
`;

  const optMd = `# Optimization Report (APIs > ${SLOW_MS} ms)

**Generated:** ${new Date().toISOString()}  
**Slow APIs found:** ${slowAnalysis.length}

${
  slowAnalysis.length === 0
    ? '_No APIs exceeded 200 ms in this run._'
    : slowAnalysis
        .sort((a, b) => b.currentResponseTime - a.currentResponseTime)
        .map(
          (s, i) => `## ${i + 1}. \`${s.endpoint}\`

| Field | Detail |
|-------|--------|
| Current response time | **${s.currentResponseTime} ms** |
| Reason for slowness | ${s.reason} |
| Root cause | ${s.rootCause} |
| Optimization suggestions | ${s.suggestions} |
| Estimated after optimization | **~${s.estimatedAfterOptimization} ms** |
`,
        )
        .join('\n')
}

## Remaining >${SLOW_MS} ms — approach table

| Endpoint | ms | Approach |
|----------|---:|----------|
${
  slowAnalysis.length === 0
    ? '| _(none)_ | — | — |'
    : slowAnalysis
        .sort((a, b) => b.currentResponseTime - a.currentResponseTime)
        .map((s) => `| \`${s.endpoint}\` | ${s.currentResponseTime} | ${s.suggestions} |`)
        .join('\n')
}

## Cross-cutting recommendations

1. **Redis caching** for dashboard, analytics charts, and admin stats (30–60s TTL). Ensure Redis is running for cache hits.
2. **Compound indexes** on high-traffic filters: \`createdAt\`, \`status\`, \`type\`, \`userId\`, \`isBlocked\`.
3. **Lean projections** — avoid returning full documents when lists only need a few fields.
4. **Export endpoints** — stream Excel generation or move to async jobs for large datasets.
5. **Atlas Search / text indexes** for admin search instead of case-insensitive regex.
6. **Pre-aggregated rollups** (daily) for revenue/session analytics to avoid live heavy aggregations.
7. **Unavoidable latency:** bcrypt login and large sync Excel builds stay >200ms without async jobs or weaker hashing (out of scope).
`;

  fs.writeFileSync(path.join(OUT_DIR, 'api-summary.md'), summaryMd, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'optimization-report.md'), optMd, 'utf8');

  let xlsxPath = path.join(OUT_DIR, 'api-performance-report.xlsx');
  try {
    await wb.xlsx.writeFile(xlsxPath);
  } catch (err) {
    if (err?.code === 'EBUSY' || err?.errno === -4082) {
      xlsxPath = path.join(OUT_DIR, `api-performance-report-${Date.now()}.xlsx`);
      await wb.xlsx.writeFile(xlsxPath);
      console.warn(`Primary xlsx locked; wrote alternate: ${xlsxPath}`);
    } else {
      throw err;
    }
  }

  console.log('\nDone.');
  console.log(`Executed: ${executed.length} | Pass: ${passed.length} | Fail: ${failed.length} | Slow: ${slow.length}`);
  console.log(`Wrote: ${xlsxPath}`);
  console.log(`Wrote: ${path.join(OUT_DIR, 'api-summary.md')}`);
  console.log(`Wrote: ${path.join(OUT_DIR, 'optimization-report.md')}`);
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  row.commit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
