import Redis from 'ioredis';
import logger from '../utils/logger.util.js';
import config from './index.js';

const redisOptions = {
  maxRetriesPerRequest: null,
  lazyConnect: true, // Do not connect automatically on boot
  showFriendlyErrorStack: config.env === 'development',
  retryStrategy(times) {
    if (times > 3) {
      // Stop retrying after 3 attempts to prevent infinite connection loops
      return null;
    }
    logger.warn(`[Redis] Retrying connection... Attempt: ${times}`);
    return Math.min(times * 500, 2000);
  }
};

/**
 * Factory function to create and monitor Redis clients cleanly.
 * Monkey-patches Redis commands so that if Redis is offline, the app 
 * simply returns null instead of throwing unhandled rejections and crashing.
 */
const createRedisClient = (clientName) => {
  const client = new Redis(config.redis.url, redisOptions);
  client.isRedisAvailable = false;

  // Patch common commands to fail silently and gracefully when Redis is offline
  const safeMethods = [
    'get', 'set', 'setex', 'del', 'keys', 'unlink', 'hget', 'hset', 'hdel', 
    'publish', 'subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe'
  ];
  
  safeMethods.forEach(method => {
    if (typeof client[method] === 'function') {
      const original = client[method].bind(client);
      client[method] = async (...args) => {
        if (!client.isRedisAvailable) return null;
        try {
          return await original(...args);
        } catch (err) {
          return null;
        }
      };
    }
  });

  // Alias for backward compatibility
  client.setEx = client.setex;

  client.on('connect', () => {
    client.isRedisAvailable = true;
    logger.info(`Redis [${clientName}] - Connected successfully`);
  });
  
  client.on('error', (err) => {
    client.isRedisAvailable = false;
  });
  
  client.on('close', () => {
    client.isRedisAvailable = false;
  });
  
  client.on('end', () => {
    client.isRedisAvailable = false;
    logger.warn(`Redis [${clientName}] - Connection ended. Caching disabled.`);
  });

  return client;
};

// 1. Main Client: Used for caching, rate limiting, and standard key-value storage.
const redisClient = createRedisClient('MainCache');

// 2. Pub/Sub Clients: Dedicated exclusively for Socket.io adapter horizontal scaling.
export const pubClient = createRedisClient('PubClient');
export const subClient = createRedisClient('SubClient');

export const connectRedis = async () => {
  try {
    await Promise.all([
      redisClient.connect(),
      pubClient.connect(),
      subClient.connect()
    ]);
  } catch (err) {
    logger.warn('⚠️  Redis not available. Real-time scaling and caching will be skipped.');
  }
};

export default redisClient;
