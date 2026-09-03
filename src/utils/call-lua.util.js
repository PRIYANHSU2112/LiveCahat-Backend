import redisClient from '../config/redis.js';
import { KEYS } from './socket-redis-keys.util.js';
import logger from './logger.util.js';

/**
 * Lua Script: Acquire 2-User Concurrency Lock and Write Call Request Payload atomically.
 * Returns 1 if lock acquired on both users, 0 if either user is already locked/ringing.
 */
const ACQUIRE_CALL_LOCKS_SCRIPT = `
local userALock = KEYS[1]
local userBLock = KEYS[2]
local reqKey = KEYS[3]
local activeRingA = KEYS[4]
local activeRingB = KEYS[5]

local callRequestId = ARGV[1]
local payload = ARGV[2]
local ttl = tonumber(ARGV[3]) or 30

if redis.call('EXISTS', userALock) == 0 and redis.call('EXISTS', userBLock) == 0 then
    redis.call('SET', userALock, callRequestId, 'EX', ttl)
    redis.call('SET', userBLock, callRequestId, 'EX', ttl)
    redis.call('SET', reqKey, payload, 'EX', ttl)
    redis.call('SET', activeRingA, callRequestId, 'EX', ttl)
    redis.call('SET', activeRingB, callRequestId, 'EX', ttl)
    return 1
else
    return 0
end
`;

/**
 * Lua Script: Claim and Accept Call atomically.
 * 1. Checks receiver ownership (must match current user).
 * 2. Checks state (must be RINGING).
 * 3. Transitions state to ACCEPTED.
 * 4. Populates active_session hash.
 * 5. Maps user_session for both users.
 * 6. Sets presence status to BUSY (unless LIVE).
 * 7. Releases ring locks.
 */
const CLAIM_AND_ACCEPT_CALL_SCRIPT = `
local reqKey = KEYS[1]
local sessionKey = KEYS[2]
local userSessionCaller = KEYS[3]
local userSessionReceiver = KEYS[4]
local presenceCaller = KEYS[5]
local presenceReceiver = KEYS[6]
local lockCaller = KEYS[7]
local lockReceiver = KEYS[8]
local activeRingCaller = KEYS[9]
local activeRingReceiver = KEYS[10]

local acceptingUserId = ARGV[1]
local sessionId = ARGV[2]
local sessionHashJson = ARGV[3]

local raw = redis.call('GET', reqKey)
if not raw then return cjson.encode({ status = 'NOT_FOUND' }) end

local data = cjson.decode(raw)
if tostring(data.receiverId) ~= tostring(acceptingUserId) then
    return cjson.encode({ status = 'UNAUTHORIZED' })
end
if data.status ~= 'RINGING' then
    return cjson.encode({ status = 'INVALID_STATE', currentStatus = data.status })
end

data.status = 'ACCEPTED'
data.sessionId = sessionId
redis.call('SET', reqKey, cjson.encode(data), 'EX', 60)

local hashData = cjson.decode(sessionHashJson)
for k, v in pairs(hashData) do
    redis.call('HSET', sessionKey, k, tostring(v))
end

redis.call('SET', userSessionCaller, sessionId)
redis.call('SET', userSessionReceiver, sessionId)

local pCaller = redis.call('GET', presenceCaller)
if pCaller ~= 'LIVE' then redis.call('SET', presenceCaller, 'BUSY') end
local pReceiver = redis.call('GET', presenceReceiver)
if pReceiver ~= 'LIVE' then redis.call('SET', presenceReceiver, 'BUSY') end

redis.call('DEL', lockCaller)
redis.call('DEL', lockReceiver)
redis.call('DEL', activeRingCaller)
redis.call('DEL', activeRingReceiver)

return cjson.encode({ status = 'OK', request = data })
`;

/**
 * Lua Script: Safe Token Lock Release on Reject, Cancel, or Timeout.
 */
const RELEASE_CALL_LOCKS_SCRIPT = `
local reqKey = KEYS[1]
local lockA = KEYS[2]
local lockB = KEYS[3]
local activeRingA = KEYS[4]
local activeRingB = KEYS[5]

local callRequestId = ARGV[1]
local newStatus = ARGV[2] or 'REJECTED'

local raw = redis.call('GET', reqKey)
if raw then
    local data = cjson.decode(raw)
    if data.status == 'RINGING' then
        data.status = newStatus
        redis.call('SET', reqKey, cjson.encode(data), 'EX', 10)
    end
end

if redis.call('GET', lockA) == callRequestId then redis.call('DEL', lockA) end
if redis.call('GET', lockB) == callRequestId then redis.call('DEL', lockB) end
if redis.call('GET', activeRingA) == callRequestId then redis.call('DEL', activeRingA) end
if redis.call('GET', activeRingB) == callRequestId then redis.call('DEL', activeRingB) end

return 1
`;

export async function acquireCallLocks(userA, userB, callRequestId, payload, ttlSec = 30) {
  if (!redisClient.isRedisAvailable) return false;
  try {
    const keys = [
      KEYS.callLock(userA),
      KEYS.callLock(userB),
      KEYS.callRequestById(callRequestId),
      KEYS.userActiveCallRing(userA),
      KEYS.userActiveCallRing(userB),
    ];
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = await redisClient.eval(
      ACQUIRE_CALL_LOCKS_SCRIPT,
      keys.length,
      ...keys,
      callRequestId,
      payloadStr,
      ttlSec
    );
    return result === 1;
  } catch (err) {
    logger.error(`[Call Lua Acquire Error] ${err.message}`);
    return false;
  }
}

export async function claimAndAcceptCall(callRequestId, acceptingUserId, sessionId, sessionHashObj) {
  if (!redisClient.isRedisAvailable) return { status: 'REDIS_UNAVAILABLE' };
  try {
    // First read raw request to know callerId & receiverId
    const rawReq = await redisClient.get(KEYS.callRequestById(callRequestId));
    if (!rawReq) return { status: 'NOT_FOUND' };
    const reqData = JSON.parse(rawReq);

    const callerId = reqData.callerId;
    const receiverId = reqData.receiverId;

    const keys = [
      KEYS.callRequestById(callRequestId),
      KEYS.activeSession(sessionId),
      KEYS.userSession(callerId),
      KEYS.userSession(receiverId),
      KEYS.presenceStatus(callerId),
      KEYS.presenceStatus(receiverId),
      KEYS.callLock(callerId),
      KEYS.callLock(receiverId),
      KEYS.userActiveCallRing(callerId),
      KEYS.userActiveCallRing(receiverId),
    ];

    const hashStr = JSON.stringify(sessionHashObj);
    const rawResult = await redisClient.eval(
      CLAIM_AND_ACCEPT_CALL_SCRIPT,
      keys.length,
      ...keys,
      acceptingUserId.toString(),
      sessionId.toString(),
      hashStr
    );

    if (!rawResult) return { status: 'FAILED' };
    return typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
  } catch (err) {
    logger.error(`[Call Lua Accept Error] ${err.message}`);
    return { status: 'ERROR', error: err.message };
  }
}

export async function releaseCallLocks(userA, userB, callRequestId, newStatus = 'REJECTED') {
  if (!redisClient.isRedisAvailable) return false;
  try {
    const keys = [
      KEYS.callRequestById(callRequestId),
      KEYS.callLock(userA),
      KEYS.callLock(userB),
      KEYS.userActiveCallRing(userA),
      KEYS.userActiveCallRing(userB),
    ];
    await redisClient.eval(
      RELEASE_CALL_LOCKS_SCRIPT,
      keys.length,
      ...keys,
      callRequestId,
      newStatus
    );
    return true;
  } catch (err) {
    logger.error(`[Call Lua Release Error] ${err.message}`);
    return false;
  }
}
