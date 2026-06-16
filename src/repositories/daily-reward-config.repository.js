import BaseRepository from './base.repository.js';
import DailyRewardConfig from '../modules/daily-reward-config.model.js';

class DailyRewardConfigRepository extends BaseRepository {
  constructor() {
    super(DailyRewardConfig);
  }
}

export default new DailyRewardConfigRepository();
