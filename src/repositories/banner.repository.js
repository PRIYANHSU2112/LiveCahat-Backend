import BaseRepository from './base.repository.js';
import Banner from '../modules/banner.model.js';

class BannerRepository extends BaseRepository {
  constructor() {
    super(Banner);
  }

  /**
   * Fetch active banners sorted by position ascending.
   */
  async findActiveSorted() {
    return await this.model.find({ isActive: true }).sort({ position: 1 }).lean();
  }
}

export default new BannerRepository();
