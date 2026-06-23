import BaseRepository from './base.repository.js';
import BankAccount from '../modules/bank-account.model.js';

class BankAccountRepository extends BaseRepository {
  constructor() {
    super(BankAccount);
  }
}

export default new BankAccountRepository();
