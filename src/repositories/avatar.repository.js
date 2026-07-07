import BaseRepository from './base.repository.js';
import Avatar from '../modules/avatar.model.js';

class AvatarRepository extends BaseRepository {
  constructor() {
    super(Avatar);
  }

  async findAdminPaginated(filter, sort, skip, limit) {
    const [docs, total] = await Promise.all([
      this.findMany(filter, '', '', sort, limit, skip),
      this.countDocuments(filter),
    ]);
    return { docs, total };
  }

  async getAdminStats() {
    const [total, active, inactive, free, paid] = await Promise.all([
      this.countDocuments({}),
      this.countDocuments({ isActive: true }),
      this.countDocuments({ isActive: false }),
      this.countDocuments({ priceType: 'FREE' }),
      this.countDocuments({ priceType: 'PAID' }),
    ]);
    return { total, active, inactive, free, paid };
  }
}

export default new AvatarRepository();
