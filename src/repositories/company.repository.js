import BaseRepository from './base.repository.js';
import Company from '../modules/company.model.js';

class CompanyRepository extends BaseRepository {
  constructor() {
    super(Company);
  }
}

export default new CompanyRepository();
