import BaseRepository from './base.repository.js';
import Company from '../modules/company.model.js';

class CompanyRepository extends BaseRepository {
  constructor() {
    super(Company);
  }

  async findPrimary() {
    return this.model.findOne({}).sort({ createdAt: -1 }).lean();
  }
}

export default new CompanyRepository();
