import redisClient from '../config/redis.js';
import ApiError from './ApiError.js';

const OTP_EXPIRY_SECONDS = 5 * 60; // 5 minutes
const MAX_ATTEMPTS = 3;

/**
 * Store OTP session (OTP + login metadata) in Redis
 * @param {String} identifier (e.g. mobile number)
 * @param {Object} session { otp, age, gender, type, countryCode? }
 */
export const storeOtpSession = async (identifier, session) => {
  const key = `otp:${identifier}`;
  const attemptsKey = `otp_attempts:${identifier}`;

  await redisClient.set(key, JSON.stringify(session), 'EX', OTP_EXPIRY_SECONDS);
  await redisClient.set(attemptsKey, 0, 'EX', OTP_EXPIRY_SECONDS);
};

/**
 * Verify OTP and return stored session metadata, then delete the session.
 * @param {String} identifier
 * @param {String} otp
 * @returns {Object} session metadata without otp
 */
export const verifyAndConsumeOtpSession = async (identifier, otp) => {
  const key = `otp:${identifier}`;
  const attemptsKey = `otp_attempts:${identifier}`;

  const raw = await redisClient.get(key);
  if (!raw) {
    throw new ApiError(400, 'OTP expired or not found');
  }

  let attempts = await redisClient.get(attemptsKey);
  attempts = parseInt(attempts, 10) || 0;

  if (attempts >= MAX_ATTEMPTS) {
    await redisClient.del(key);
    await redisClient.del(attemptsKey);
    throw new ApiError(400, 'Maximum OTP verification attempts reached. Please request a new OTP.');
  }

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'OTP expired or not found');
  }

  if (String(session.otp) !== String(otp).trim()) {
    await redisClient.incr(attemptsKey);
    throw new ApiError(400, 'Invalid OTP');
  }

  await redisClient.del(key);
  await redisClient.del(attemptsKey);

  const { otp: _otp, ...metadata } = session;
  return metadata;
};

/** @deprecated Use storeOtpSession */
export const storeOTP = async (identifier, otp) => {
  await storeOtpSession(identifier, { otp });
};

/** @deprecated Use verifyAndConsumeOtpSession */
export const verifyOTP = async (identifier, otp) => {
  await verifyAndConsumeOtpSession(identifier, otp);
  return true;
};

// ==========================================
// General Caching Utilities
// ==========================================

/**
 * Get data from Redis Cache
 */
export const getCache = async (key) => {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Redis Get Error [${key}]:`, error);
    return null;
  }
};

/**
 * Set data to Redis Cache
 * @param {String} key 
 * @param {Object} data 
 * @param {Number} ttlSeconds default 5 mins
 */
export const setCache = async (key, data, ttlSeconds = 300) => {
  try {
    await redisClient.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch (error) {
    console.error(`Redis Set Error [${key}]:`, error);
  }
};

/**
 * Delete a specific key from Redis
 */
export const deleteCache = async (key) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error(`Redis Del Error [${key}]:`, error);
  }
};

/**
 * Clear multiple cache keys by pattern (e.g., 'users:*')
 */
export const clearCachePattern = (pattern) => {
  return new Promise((resolve, reject) => {
    const stream = redisClient.scanStream({ match: pattern, count: 100 });
    const keysToDelete = [];
    
    stream.on('data', (keys) => {
      if (keys.length) {
        keysToDelete.push(...keys);
      }
    });
    
    stream.on('end', async () => {
      if (keysToDelete.length > 0) {
        try {
          await redisClient.del(...keysToDelete);
        } catch (err) {
          console.error(`Redis Del Pattern Error [${pattern}]:`, err);
        }
      }
      resolve();
    });
    
    stream.on('error', (err) => {
      console.error(`Redis Scan Error [${pattern}]:`, err);
      resolve(); // resolve anyway to not break app flow
    });
  });
};

/**
 * Increment and get the current cache version for a namespace
 */
export const bumpCacheVersion = async (namespace) => {
  try {
    return await redisClient.incr(`${namespace}:version`);
  } catch (error) {
    console.error(`Redis Version Bump Error [${namespace}]:`, error);
    return Date.now();
  }
};

/**
 * Get the current cache version for a namespace
 */
export const getCacheVersion = async (namespace) => {
  try {
    let version = await redisClient.get(`${namespace}:version`);
    if (!version) {
      version = await bumpCacheVersion(namespace);
    }
    return version;
  } catch (error) {
    console.error(`Redis Version Get Error [${namespace}]:`, error);
    return 1;
  }
};
