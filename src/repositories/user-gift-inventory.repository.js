import BaseRepository from './base.repository.js';
import UserGiftInventory from '../modules/user-gift-inventory.model.js';

class UserGiftInventoryRepository extends BaseRepository {
  constructor() {
    super(UserGiftInventory);
  }

  async findByUserId(userId, lean = true) {
    return await this.findMany({ userId }, '', 'giftId', { createdAt: -1 }, 100, 0, lean);
  }
}

export default new UserGiftInventoryRepository();
