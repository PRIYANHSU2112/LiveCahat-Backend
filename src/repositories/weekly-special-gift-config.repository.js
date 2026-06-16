import BaseRepository from './base.repository.js';
import WeeklySpecialGiftConfig from '../modules/weekly-special-gift-config.model.js';

class WeeklySpecialGiftConfigRepository extends BaseRepository {
  constructor() {
    super(WeeklySpecialGiftConfig);
  }
}

export default new WeeklySpecialGiftConfigRepository();
