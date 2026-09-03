import redisClient from '../config/redis.js';
import { KEYS } from './socket-redis-keys.util.js';
import logger from './logger.util.js';

/**
 * Atomic Lua Script: Wallet Debit + Idempotency + Stream Route + Unread Update
 *
 * Single atomic operation that:
 * 1. Checks clientMsgId idempotency (prevents duplicate coin deductions on retries).
 * 2. Checks customer wallet balance in Redis.
 * 3. Debits coins atomically (DECRBY).
 * 4. Marks idempotency key with 24h TTL.
 * 5. Appends message payload to receiver's Redis Stream (if receiver offline).
 * 6. Increments per-sender unread counter for receiver.
 *
 * KEYS[1] = msg:idempotency:<clientMsgId>
 * KEYS[2] = wallet:user:<customerId>:balance
 * KEYS[3] = chat:mailbox:stream:<receiverId>
 * KEYS[4] = unread:user:<receiverId>
 *
 * ARGV[1] = clientMsgId
 * ARGV[2] = cost (integer, 0 for free messages or listener-to-customer)
 * ARGV[3] = payloadJson (full message JSON to store in stream)
 * ARGV[4] = senderId (for unread hash field)
 * ARGV[5] = isReceiverOnline ("1" or "0")
 * ARGV[6] = serverTimestamp (ISO string, for sequence ordering)
 *
 * Returns msgpack-encoded table:
 *   { "OK", newBalance } on success
 *   { "ALREADY_PROCESSED", currentBalance } on duplicate clientMsgId
 *   { "INSUFFICIENT_BALANCE", currentBalance } on insufficient coins
 */
const DEDUCT_AND_ROUTE_SCRIPT = `
local idempotencyKey = KEYS[1]
local balanceKey = KEYS[2]
local streamKey = KEYS[3]
local unreadKey = KEYS[4]

local clientMsgId = ARGV[1]
local cost = tonumber(ARGV[2]) or 0
local payloadJson = ARGV[3]
local senderId = ARGV[4]
local isReceiverOnline = ARGV[5]
local serverTs = ARGV[6]

-- 1. Idempotency check: if this clientMsgId was already processed, skip everything
if redis.call('EXISTS', idempotencyKey) == 1 then
    local curBal = tonumber(redis.call('GET', balanceKey) or '0')
    return { 'ALREADY_PROCESSED', curBal }
end

-- 2. Balance check (only if cost > 0)
local bal = tonumber(redis.call('GET', balanceKey) or '0')
if cost > 0 and bal < cost then
    return { 'INSUFFICIENT_BALANCE', bal }
end

-- 3. Atomic debit
if cost > 0 then
    bal = redis.call('DECRBY', balanceKey, cost)
end

-- 4. Mark idempotency processed (24h TTL)
redis.call('SET', idempotencyKey, 'PROCESSED', 'EX', 86400)

-- 5. Route to receiver's stream if offline
if isReceiverOnline == '0' then
    redis.call('XADD', streamKey, 'MAXLEN', '~', 1000, '*',
        'clientMsgId', clientMsgId,
        'payload', payloadJson,
        'senderId', senderId,
        'serverTs', serverTs)
end

-- 6. Increment per-sender unread counter for receiver
redis.call('HINCRBY', unreadKey, senderId, 1)

return { 'OK', bal }
`;

/**
 * Atomically debit wallet, check idempotency, route to stream, and update unread.
 *
 * @param {Object} opts
 * @param {string} opts.clientMsgId   - Client-generated UUID for idempotent retry
 * @param {string} opts.senderId      - The user sending the message
 * @param {string} opts.receiverId    - The user receiving the message
 * @param {number} opts.cost          - Coins to deduct (0 for free/listener messages)
 * @param {Object} opts.payload       - Full message payload object to persist in stream
 * @param {boolean} opts.isReceiverOnline - Whether the receiver is currently connected
 * @param {string} opts.serverTimestamp   - Server ISO timestamp for ordering
 * @returns {{ status: string, balance: number }}
 */
export async function deductAndRouteMessage({
  clientMsgId,
  senderId,
  receiverId,
  cost = 0,
  payload,
  isReceiverOnline = false,
  serverTimestamp,
}) {
  if (!redisClient.isRedisAvailable) {
    return { status: 'REDIS_UNAVAILABLE', balance: -1 };
  }

  try {
    const keys = [
      KEYS.msgIdempotency(clientMsgId),
      KEYS.walletBalance(senderId),
      KEYS.chatMailboxStream(receiverId),
      KEYS.unreadUser(receiverId),
    ];

    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const result = await redisClient.eval(
      DEDUCT_AND_ROUTE_SCRIPT,
      keys.length,
      ...keys,
      clientMsgId,
      String(cost),
      payloadStr,
      senderId,
      isReceiverOnline ? '1' : '0',
      serverTimestamp || new Date().toISOString()
    );

    // Redis returns an array: [statusString, balanceNumber]
    const status = result[0];
    const balance = parseInt(result[1], 10) || 0;

    return { status, balance };
  } catch (err) {
    logger.error(`[Chat Lua DeductAndRoute Error] ${err.message}`);
    return { status: 'ERROR', balance: -1, error: err.message };
  }
}

/**
 * Read all pending messages from a receiver's offline mailbox stream.
 * Does NOT delete entries — entries persist until explicit ACK.
 *
 * @param {string} receiverId
 * @returns {Array<{ entryId: string, clientMsgId: string, payload: Object, senderId: string, serverTs: string }>}
 */
export async function readMailboxStream(receiverId) {
  if (!redisClient.isRedisAvailable) return [];

  try {
    const streamKey = KEYS.chatMailboxStream(receiverId);
    // XRANGE returns all entries from beginning to end
    const entries = await redisClient.xrange(streamKey, '-', '+');
    if (!entries || entries.length === 0) return [];

    return entries.map(([entryId, fields]) => {
      // fields is a flat array: ['clientMsgId', 'val', 'payload', 'val', ...]
      const fieldMap = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap[fields[i]] = fields[i + 1];
      }
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(fieldMap.payload);
      } catch {
        parsedPayload = fieldMap.payload;
      }
      return {
        entryId,
        clientMsgId: fieldMap.clientMsgId,
        payload: parsedPayload,
        senderId: fieldMap.senderId,
        serverTs: fieldMap.serverTs,
      };
    });
  } catch (err) {
    logger.error(`[Chat Lua ReadMailbox Error] ${err.message}`);
    return [];
  }
}

/**
 * ACK and delete specific stream entries from a receiver's mailbox.
 * Only called AFTER the receiver's client socket confirms delivery.
 *
 * @param {string} receiverId
 * @param {string[]} entryIds - Array of Redis Stream entry IDs to delete
 * @returns {number} Number of entries deleted
 */
export async function ackMailboxMessages(receiverId, entryIds) {
  if (!redisClient.isRedisAvailable || !entryIds?.length) return 0;

  try {
    const streamKey = KEYS.chatMailboxStream(receiverId);
    const deleted = await redisClient.xdel(streamKey, ...entryIds);
    return deleted;
  } catch (err) {
    logger.error(`[Chat Lua AckMailbox Error] ${err.message}`);
    return 0;
  }
}

/**
 * Update the monotonic lastReadMessageId for a user in a conversation.
 * Only advances forward (newId must be > currentId as a string comparison on ObjectIds).
 *
 * @param {string} userId
 * @param {string} partnerId
 * @param {string} lastReadMessageId - MongoDB ObjectId string of the last read message
 * @returns {{ updated: boolean, previousId: string|null }}
 */
export async function updateReadPointer(userId, partnerId, lastReadMessageId) {
  if (!redisClient.isRedisAvailable) {
    return { updated: false, previousId: null };
  }

  try {
    const readKey = KEYS.convRead(userId, partnerId);
    const readTsKey = KEYS.convReadTs(userId, partnerId);
    const unreadKey = KEYS.unreadUser(userId);

    const currentId = await redisClient.get(readKey);

    // Monotonic forward-only: only update if new > current
    if (currentId && lastReadMessageId <= currentId) {
      return { updated: false, previousId: currentId };
    }

    const now = new Date().toISOString();
    await redisClient.set(readKey, lastReadMessageId);
    await redisClient.set(readTsKey, now);

    // Reset unread count for this sender
    await redisClient.hdel(unreadKey, partnerId);

    return { updated: true, previousId: currentId || null };
  } catch (err) {
    logger.error(`[Chat Lua UpdateReadPointer Error] ${err.message}`);
    return { updated: false, previousId: null };
  }
}

/**
 * Get unread counts per sender for a user (for inbox badge display).
 *
 * @param {string} userId
 * @returns {Object<string, number>} Map of senderId → unread count
 */
export async function getUnreadCounts(userId) {
  if (!redisClient.isRedisAvailable) return {};

  try {
    const unreadKey = KEYS.unreadUser(userId);
    const raw = await redisClient.hgetall(unreadKey);
    if (!raw) return {};

    const counts = {};
    for (const [senderId, count] of Object.entries(raw)) {
      counts[senderId] = parseInt(count, 10) || 0;
    }
    return counts;
  } catch (err) {
    logger.error(`[Chat Lua GetUnreadCounts Error] ${err.message}`);
    return {};
  }
}
