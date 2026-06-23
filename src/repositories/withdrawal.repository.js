import BaseRepository from './base.repository.js';
import Withdrawal from '../modules/withdrawal.model.js';

class WithdrawalRepository extends BaseRepository {
  constructor() {
    super(Withdrawal);
  }
}

export default new WithdrawalRepository();
