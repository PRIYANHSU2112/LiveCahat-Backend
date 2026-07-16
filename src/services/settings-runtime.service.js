import logger from '../utils/logger.util.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import { decryptSecret } from '../utils/settings-crypto.util.js';
import { pubClient, subClient } from '../config/redis.js';
import PlatformSettings from '../modules/platform-settings.model.js';
import PaymentGateway from '../modules/payment-gateway.model.js';
import {
  SETTINGS_INVALIDATE_CHANNEL,
  PLATFORM_SETTINGS_REDIS_KEY,
  PAYMENT_GATEWAYS_REDIS_KEY,
  SETTINGS_REDIS_TTL_SECONDS,
  DEFAULT_PLATFORM_SETTINGS,
} from '../constants/settings.constant.js';

/**
 * In-memory settings snapshot for O(1) hot-path reads.
 * Never query Mongo/Redis from sockets — only read this memory.
 */
class SettingsRuntimeService {
  #platform = { ...DEFAULT_PLATFORM_SETTINGS };
  #gateways = [];
  /** @type {Map<string, { publicKey: string, secret: string, webhookSecret: string|null, mode: string, merchantId: string }>} */
  #credentialsByProvider = new Map();
  #defaultProvider = null;
  #version = 0;
  #loadedAt = null;
  #subscribed = false;
  #razorpayClient = null;
  #razorpayClientKey = null;

  getPlatform() {
    return this.#platform;
  }

  isMaintenanceMode() {
    return Boolean(this.#platform?.maintenanceMode);
  }

  allowRegistrations() {
    return this.#platform?.allowRegistrations !== false;
  }

  getDefaultLanguage() {
    return this.#platform?.defaultLanguage || 'en';
  }

  getGatewaysPublic() {
    return this.#gateways;
  }

  getDefaultProvider() {
    return this.#defaultProvider;
  }

  /**
   * Sync credential lookup for checkout/webhooks (memory only).
   * @param {string} provider
   */
  getPaymentCredentials(provider) {
    if (!provider) return null;
    return this.#credentialsByProvider.get(String(provider).toUpperCase()) || null;
  }

  getDefaultPaymentCredentials() {
    if (this.#defaultProvider) {
      return this.getPaymentCredentials(this.#defaultProvider);
    }
    return null;
  }

  /**
   * Warm memory from Redis → Mongo. Safe to call repeatedly.
   */
  async warm() {
    try {
      await this.#loadPlatform();
      await this.#loadGateways();
      this.#version += 1;
      this.#loadedAt = Date.now();
      this.#razorpayClient = null;
      this.#razorpayClientKey = null;
      logger.info(
        `[SettingsRuntime] Warmed platform + ${this.#gateways.length} gateway(s), v${this.#version}`
      );
    } catch (err) {
      logger.error(`[SettingsRuntime] Warm failed: ${err.message}`);
      this.#platform = { ...DEFAULT_PLATFORM_SETTINGS };
    }
  }

  async publishInvalidate(reason = 'update') {
    try {
      if (pubClient?.isRedisAvailable) {
        await pubClient.publish(SETTINGS_INVALIDATE_CHANNEL, JSON.stringify({ reason, at: Date.now() }));
      }
    } catch (err) {
      logger.warn(`[SettingsRuntime] Publish invalidate failed: ${err.message}`);
    }
    await this.warm();
  }

  /**
   * Subscribe once for cross-instance invalidation.
   */
  async startSubscriber() {
    if (this.#subscribed) return;
    try {
      if (!subClient) return;

      subClient.on('message', (channel, message) => {
        if (channel !== SETTINGS_INVALIDATE_CHANNEL) return;
        logger.info(`[SettingsRuntime] Invalidate received: ${message}`);
        this.warm().catch((err) =>
          logger.error(`[SettingsRuntime] Reload after invalidate failed: ${err.message}`)
        );
      });

      if (subClient.isRedisAvailable) {
        await subClient.subscribe(SETTINGS_INVALIDATE_CHANNEL);
        this.#subscribed = true;
        logger.info(`[SettingsRuntime] Subscribed to ${SETTINGS_INVALIDATE_CHANNEL}`);
      } else {
        // Retry subscribe shortly after Redis connects
        setTimeout(() => {
          this.#subscribed = false;
          this.startSubscriber().catch(() => {});
        }, 3000);
      }
    } catch (err) {
      logger.warn(`[SettingsRuntime] Subscribe failed: ${err.message}`);
    }
  }

  async persistPlatformToRedis(doc) {
    const payload = this.#sanitizePlatform(doc);
    await setCache(PLATFORM_SETTINGS_REDIS_KEY, payload, SETTINGS_REDIS_TTL_SECONDS);
    return payload;
  }

  async persistGatewaysToRedis(docs) {
    await setCache(PAYMENT_GATEWAYS_REDIS_KEY, docs, SETTINGS_REDIS_TTL_SECONDS);
  }

  async clearPlatformRedis() {
    await deleteCache(PLATFORM_SETTINGS_REDIS_KEY);
  }

  async clearGatewaysRedis() {
    await deleteCache(PAYMENT_GATEWAYS_REDIS_KEY);
  }

  /**
   * Lazy Razorpay SDK client from runtime credentials or env fallback.
   */
  async getRazorpayClient() {
    const { default: Razorpay } = await import('razorpay');
    const creds = this.getPaymentCredentials('RAZORPAY');
    const key_id = creds?.publicKey || process.env.RAZORPAY_KEY_ID || 'mock_key_id';
    const key_secret = creds?.secret || process.env.RAZORPAY_KEY_SECRET || 'mock_key_secret';
    const cacheKey = `${key_id}:${key_secret.slice(0, 8)}`;
    if (this.#razorpayClient && this.#razorpayClientKey === cacheKey) {
      return this.#razorpayClient;
    }
    this.#razorpayClient = new Razorpay({ key_id, key_secret });
    this.#razorpayClientKey = cacheKey;
    return this.#razorpayClient;
  }

  getRazorpayWebhookSecret() {
    const creds = this.getPaymentCredentials('RAZORPAY');
    return (
      creds?.webhookSecret ||
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      process.env.RAZORPAY_KEY_SECRET ||
      'mock_webhook_secret'
    );
  }

  getRazorpayPublicKey() {
    const creds = this.getPaymentCredentials('RAZORPAY');
    return creds?.publicKey || process.env.RAZORPAY_KEY_ID || 'mock_key_id';
  }

  async #loadPlatform() {
    let cached = await getCache(PLATFORM_SETTINGS_REDIS_KEY);
    if (!cached) {
      let doc = await PlatformSettings.findOne().lean();
      if (!doc) {
        doc = (await PlatformSettings.create({})).toObject();
      }
      cached = this.#sanitizePlatform(doc);
      await setCache(PLATFORM_SETTINGS_REDIS_KEY, cached, SETTINGS_REDIS_TTL_SECONDS);
    }
    this.#platform = { ...DEFAULT_PLATFORM_SETTINGS, ...cached };
  }

  async #loadGateways() {
    let docs = await getCache(PAYMENT_GATEWAYS_REDIS_KEY);
    if (!docs) {
      docs = await PaymentGateway.find({ isDeleted: false }).lean();
      await setCache(PAYMENT_GATEWAYS_REDIS_KEY, docs, SETTINGS_REDIS_TTL_SECONDS);
    }
    if (!Array.isArray(docs)) docs = [];

    this.#gateways = docs.map((d) => this.#toPublicGateway(d));
    this.#credentialsByProvider.clear();
    this.#defaultProvider = null;

    for (const doc of docs) {
      if (!doc.isEnabled || doc.isDeleted) continue;
      const secret = decryptSecret(doc.secretEncrypted);
      if (!secret) continue;
      const webhookSecret = decryptSecret(doc.webhookSecretEncrypted);
      this.#credentialsByProvider.set(doc.provider, {
        provider: doc.provider,
        publicKey: doc.publicKey || '',
        secret,
        webhookSecret,
        mode: doc.mode,
        merchantId: doc.merchantId || '',
      });
      if (doc.isDefault) {
        this.#defaultProvider = doc.provider;
      }
    }

    if (!this.#defaultProvider && this.#credentialsByProvider.has('RAZORPAY')) {
      this.#defaultProvider = 'RAZORPAY';
    }
  }

  #sanitizePlatform(doc) {
    return {
      maintenanceMode: Boolean(doc.maintenanceMode),
      allowRegistrations: doc.allowRegistrations !== false,
      defaultLanguage: doc.defaultLanguage || 'en',
      featureFlags: doc.featureFlags && typeof doc.featureFlags === 'object' ? doc.featureFlags : {},
      updatedAt: doc.updatedAt || null,
    };
  }

  #toPublicGateway(doc) {
    return {
      _id: doc._id?.toString?.() || doc._id,
      provider: doc.provider,
      displayName: doc.displayName,
      mode: doc.mode,
      isEnabled: Boolean(doc.isEnabled),
      isDefault: Boolean(doc.isDefault),
      publicKey: doc.publicKey || '',
      merchantId: doc.merchantId || '',
      hasSecret: Boolean(doc.secretEncrypted?.ciphertext),
      hasWebhookSecret: Boolean(doc.webhookSecretEncrypted?.ciphertext),
      secretLast4: doc.secretLast4 || null,
      webhookSecretLast4: doc.webhookSecretLast4 || null,
      config: doc.config || {},
      updatedAt: doc.updatedAt || null,
    };
  }
}

export default new SettingsRuntimeService();
