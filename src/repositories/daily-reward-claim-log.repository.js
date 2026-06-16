import BaseRepository from './base.repository.js';
import DailyRewardClaimLog from '../modules/daily-reward-claim-log.model.js';

class DailyRewardClaimLogRepository extends BaseRepository {
  constructor() {
    super(DailyRewardClaimLog);
  }
}

export default new DailyRewardClaimLogRepository();
