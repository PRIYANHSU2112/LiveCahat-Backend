import BaseRepository from './base.repository.js';
import SessionSegment from '../modules/session-segment.model.js';

class SessionSegmentRepository extends BaseRepository {
  constructor() {
    super(SessionSegment);
  }

  /**
   * Find all segments associated with a session ID.
   */
  async findManyBySessionId(sessionId) {
    return await this.findMany({ sessionId }, '', '', { startTime: 1 }, 100, 0);
  }

  /**
   * Find the active segment for a session ID.
   */
  async findActiveBySessionId(sessionId) {
    return await this.findOne({ sessionId, status: 'ONGOING' });
  }
}

export default new SessionSegmentRepository();
