import redisClient from '../config/redis.js';
import User from '../modules/user.model.js';
import communicationSessionRepository from '../repositories/communication-session.repository.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import { getSocketIo } from '../utils/socket.util.js';
import { bumpCacheVersion } from '../utils/redis.util.js';
import presenceService from './presence.service.js';
import { formatCustomerCard } from '../utils/customer-card.util.js';
import logger from '../utils/logger.util.js';

const CUSTOMER_SELECT = 'firstName lastName profileImage gender countryCode currentLevel totalXp isOnline';

class ListenerInteractionService {
  /**
   * Persist listener↔customer interaction and optionally notify the listener in real time.
   */
  async markListenerCustomerInteraction(listenerId, customerId, { emit = true } = {}) {
    const listenerIdStr = listenerId?.toString();
    const customerIdStr = customerId?.toString();
    if (!listenerIdStr || !customerIdStr || listenerIdStr === customerIdStr) return false;

    let isNew = false;

    if (redisClient.isRedisAvailable) {
      const listenerKey = KEYS.listenerInteracted(listenerIdStr);
      const customerKey = KEYS.customerInteractedListeners(customerIdStr);

      const added = await redisClient.sadd(listenerKey, customerIdStr);
      await redisClient.sadd(customerKey, listenerIdStr);
      isNew = added === 1;
    } else {
      const already = await this._distinctCallersFromMongo(listenerIdStr);
      isNew = !already.includes(customerIdStr);
    }

    await bumpCacheVersion(`listener:home:${listenerIdStr}`);

    if (emit && isNew) {
      await this.broadcastListenerHomeInteraction(listenerIdStr, customerIdStr);
    }

    return isNew;
  }

  /**
   * Load interacted customer IDs for a listener (lazy Mongo backfill when Redis SET is empty).
   */
  async getInteractedCustomerIds(listenerId) {
    const listenerIdStr = listenerId?.toString();

    if (redisClient.isRedisAvailable) {
      const key = KEYS.listenerInteracted(listenerIdStr);
      let members = await redisClient.smembers(key);

      if (!members.length) {
        members = await this._backfillFromMongo(listenerIdStr);
      }

      return members;
    }

    return this._distinctCallersFromMongo(listenerIdStr);
  }

  /**
   * Check whether a customer has interacted with a listener.
   */
  async hasInteracted(listenerId, customerId) {
    const listenerIdStr = listenerId?.toString();
    const customerIdStr = customerId?.toString();

    if (redisClient.isRedisAvailable) {
      const key = KEYS.listenerInteracted(listenerIdStr);
      const count = await redisClient.scard(key);
      if (count === 0) {
        await this._backfillFromMongo(listenerIdStr);
      }
      return (await redisClient.sismember(key, customerIdStr)) === 1;
    }

    const ids = await this._distinctCallersFromMongo(listenerIdStr);
    return ids.includes(customerIdStr);
  }

  async _backfillFromMongo(listenerId) {
    const callerIds = await this._distinctCallersFromMongo(listenerId);

    if (redisClient.isRedisAvailable && callerIds.length) {
      const listenerKey = KEYS.listenerInteracted(listenerId);
      const pipeline = redisClient.pipeline();
      pipeline.sadd(listenerKey, ...callerIds);
      callerIds.forEach((customerId) => {
        pipeline.sadd(KEYS.customerInteractedListeners(customerId), listenerId);
      });
      await pipeline.exec();
    }

    return callerIds;
  }

  async _distinctCallersFromMongo(listenerId) {
    const ids = await communicationSessionRepository.model.distinct('callerId', { listenerId });
    return ids.map((id) => id.toString());
  }

  /**
   * Batch membership check against Redis interacted SET.
   */
  async filterInteractedIds(listenerId, customerIds) {
    if (!customerIds?.length) return new Set();

    const listenerIdStr = listenerId?.toString();

    if (!redisClient.isRedisAvailable) {
      const all = new Set(await this.getInteractedCustomerIds(listenerIdStr));
      return new Set(customerIds.filter((id) => all.has(id.toString())));
    }

    const key = KEYS.listenerInteracted(listenerIdStr);
    const count = await redisClient.scard(key);
    if (count === 0) {
      await this._backfillFromMongo(listenerIdStr);
    }

    const pipeline = redisClient.pipeline();
    customerIds.forEach((id) => pipeline.sismember(key, id.toString()));
    const results = await pipeline.exec();

    const interacted = new Set();
    customerIds.forEach((id, index) => {
      if (results[index]?.[1] === 1) {
        interacted.add(id.toString());
      }
    });
    return interacted;
  }

  /**
   * Notify listeners who have interacted with this customer about presence change.
   */
  async broadcastListenerHomePresence(customerId, status) {
    const customerIdStr = customerId?.toString();
    const io = getSocketIo();
    if (!io) return;

    let listenerIds = [];
    if (redisClient.isRedisAvailable) {
      listenerIds = await redisClient.smembers(KEYS.customerInteractedListeners(customerIdStr));
    }

    if (!listenerIds.length) return;

    const isOnline = status !== 'OFFLINE';
    const payload = {
      customerId: customerIdStr,
      status,
      isOnline,
      sectionHints: ['online', 'popular', 'new'],
    };

    listenerIds.forEach((listenerId) => {
      io.to(listenerId).emit(SERVER_EVENTS.LISTENER_HOME_PRESENCE, payload);
    });
  }

  /**
   * Notify listener that a new interaction started (customer leaves "new users").
   */
  async broadcastListenerHomeInteraction(listenerId, customerId) {
    const io = getSocketIo();
    if (!io) return;

    try {
      const user = await User.findById(customerId).select(CUSTOMER_SELECT).lean();
      if (!user) return;

      const liveStatus = await presenceService.getStatus(customerId);
      const userCard = formatCustomerCard(user, {
        liveStatus,
        isOnline: liveStatus !== 'OFFLINE',
      });

      io.to(listenerId.toString()).emit(SERVER_EVENTS.LISTENER_HOME_INTERACTION, {
        customerId: customerId.toString(),
        action: 'interaction_started',
        user: userCard,
      });
    } catch (err) {
      logger.error(`[ListenerInteraction] broadcast interaction failed: ${err.message}`);
    }
  }
}

export default new ListenerInteractionService();
