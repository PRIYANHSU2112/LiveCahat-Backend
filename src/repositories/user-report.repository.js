import BaseRepository from './base.repository.js';
import UserReport from '../modules/user-report.model.js';

class UserReportRepository extends BaseRepository {
  constructor() {
    super(UserReport);
  }
}

export default new UserReportRepository();
