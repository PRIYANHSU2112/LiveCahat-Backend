import BaseRepository from './base.repository.js';
import DailyRewardState from '../modules/daily-reward-state.model.js';

class DailyRewardStateRepository extends BaseRepository {
  constructor() {
    super(DailyRewardState);
  }

  async findByUserId(userId, lean = true) {
    return await this.findOne({ userId }, '', '', lean);
  }
}

export default new DailyRewardStateRepository();
