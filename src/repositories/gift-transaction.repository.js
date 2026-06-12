import BaseRepository from './base.repository.js';
import GiftTransaction from '../modules/gift-transaction.model.js';

class GiftTransactionRepository extends BaseRepository {
  constructor() {
    super(GiftTransaction);
  }

  /**
   * Get paginated gift transactions with populated details.
   */
  async getPaginatedTransactions(matchQuery, sort, skip, limit) {
    const total = await this.model.countDocuments(matchQuery);
    const data = await this.model.find(matchQuery)
      .populate('giftId')
      .populate('senderId', 'firstName lastName profileImage type')
      .populate('receiverId', 'firstName lastName profileImage type')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
    return { total, data };
  }
}

export default new GiftTransactionRepository();
