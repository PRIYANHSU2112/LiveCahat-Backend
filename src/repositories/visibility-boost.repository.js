import BaseRepository from './base.repository.js';
import VisibilityBoost from '../modules/visibility-boost.model.js';

class VisibilityBoostRepository extends BaseRepository {
  constructor() {
    super(VisibilityBoost);
  }

  /**
   * Count currently active (non-expired) boosts within a transaction session.
   * @param {import('mongoose').ClientSession} [session]
   * @returns {Promise<number>}
   */
  async countActiveBoosts(session = null) {
    const query = {
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    };
    if (session) {
      return await VisibilityBoost.countDocuments(query).session(session);
    }
    return await VisibilityBoost.countDocuments(query);
  }

  /**
   * Atomically determine the next sequence number for a new boost.
   * Finds the highest sequence among currently active boosts and returns +1.
   * @param {import('mongoose').ClientSession} [session]
   * @returns {Promise<number>}
   */
  async getNextSequence(session = null) {
    const query = VisibilityBoost.findOne({ status: 'ACTIVE', expiresAt: { $gt: new Date() } })
      .sort({ sequence: -1 })
      .select('sequence')
      .lean();
    if (session) query.session(session);
    const last = await query;
    return (last?.sequence || 0) + 1;
  }

  /**
   * Find a completed boost by its idempotency key (for retry detection).
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async findByIdempotencyKey(key) {
    if (!key) return null;
    return await VisibilityBoost.findOne({ idempotencyKey: key }).lean();
  }

  /**
   * Bulk-mark expired boosts. Returns the count of modified documents.
   * @param {import('mongoose').ClientSession} [session]
   * @returns {Promise<number>}
   */
  async markExpired(session = null) {
    const filter = { status: 'ACTIVE', expiresAt: { $lte: new Date() } };
    const update = { $set: { status: 'EXPIRED' } };
    const opts = session ? { session } : {};
    const result = await VisibilityBoost.updateMany(filter, update, opts);
    return result.modifiedCount || 0;
  }

  /**
   * Get active, non-expired boost listenerIds ordered by sequence (for Home API).
   * @returns {Promise<Array<{listenerId: ObjectId, sequence: number}>>}
   */
  async getActiveBoostsForHome() {
    return await VisibilityBoost.find({
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    })
      .sort({ sequence: 1 })
      .select('listenerId sequence')
      .lean();
  }

  /**
   * Check if a listener already has an active boost.
   * @param {string|ObjectId} listenerId
   * @param {import('mongoose').ClientSession} [session]
   * @returns {Promise<Object|null>}
   */
  async findActiveByListener(listenerId, session = null) {
    const query = VisibilityBoost.findOne({
      listenerId,
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    }).lean();
    if (session) query.session(session);
    return await query;
  }
}

export default new VisibilityBoostRepository();
