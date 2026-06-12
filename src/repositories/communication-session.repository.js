import BaseRepository from './base.repository.js';
import CommunicationSession from '../modules/communication-session.model.js';

class CommunicationSessionRepository extends BaseRepository {
  constructor() {
    super(CommunicationSession);
  }

  /**
   * Find any ongoing session for a given user (either caller or listener).
   */
  async findActiveByUserId(userId) {
    return await this.findOne({
      $or: [{ callerId: userId }, { listenerId: userId }],
      status: 'ONGOING',
    });
  }
}

export default new CommunicationSessionRepository();
