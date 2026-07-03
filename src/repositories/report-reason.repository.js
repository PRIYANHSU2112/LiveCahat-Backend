import BaseRepository from './base.repository.js';
import ReportReason from '../modules/report-reason.model.js';

class ReportReasonRepository extends BaseRepository {
  constructor() {
    super(ReportReason);
  }
}

export default new ReportReasonRepository();
