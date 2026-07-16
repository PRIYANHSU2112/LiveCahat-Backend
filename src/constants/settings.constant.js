export const SETTINGS_INVALIDATE_CHANNEL = 'settings:invalidate';

export const PLATFORM_SETTINGS_REDIS_KEY = 'platform:settings:v1';
export const PAYMENT_GATEWAYS_REDIS_KEY = 'payment:gateways:v1';

/** Long-lived Redis snapshot; writes always invalidate explicitly */
export const SETTINGS_REDIS_TTL_SECONDS = 24 * 60 * 60;

export const PAYMENT_GATEWAY_PROVIDERS = [
  'RAZORPAY',
  'STRIPE',
  'PAYPAL',
  'CASHFREE',
  'APPLE_PAY',
  'GOOGLE_PAY',
];

export const PAYMENT_GATEWAY_MODES = ['sandbox', 'live'];

export const DEFAULT_PLATFORM_SETTINGS = {
  maintenanceMode: false,
  allowRegistrations: true,
  defaultLanguage: 'en',
  featureFlags: {},
};
