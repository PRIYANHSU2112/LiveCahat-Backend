import { EventEmitter } from 'events';
import logger from '../utils/logger.util.js';

/**
 * Follow Event Bus — Lightweight event-driven architecture.
 *
 * Uses Node.js native EventEmitter (not BullMQ) because:
 *   - Follow events are lightweight (~1KB payload)
 *   - No retry/persistence needed for logging
 *   - Notification delivery is fire-and-forget via Firebase SDK
 *   - If guaranteed delivery needed later, swap listener to enqueue into BullMQ
 */
class FollowEventBus extends EventEmitter {
  constructor() {
    super();
    this._registerListeners();
  }

  _registerListeners() {
    // ─── Analytics Logging ────────────────────────────────────
    this.on('user:followed', ({ followerId, followingId }) => {
      logger.info(`[FollowEvent] User ${followerId} followed ${followingId}`);
    });

    this.on('user:unfollowed', ({ followerId, followingId }) => {
      logger.info(`[FollowEvent] User ${followerId} unfollowed ${followingId}`);
    });

    this.on('user:favorite:toggled', ({ followerId, followingId, isFavorite }) => {
      logger.info(`[FollowEvent] User ${followerId} ${isFavorite ? 'favorited' : 'unfavorited'} ${followingId}`);
    });

    // ─── Notification Stub ────────────────────────────────────
    // Ready to plug into Firebase push notifications:
    //
    // this.on('user:followed', async ({ followerId, followingId }) => {
    //   const follower = await User.findById(followerId).select('firstName').lean();
    //   await sendPushNotification(followingId, {
    //     title: 'New Follower!',
    //     body: `${follower.firstName} started following you`,
    //   });
    // });
  }
}

// Singleton instance
const followEvents = new FollowEventBus();
export default followEvents;
