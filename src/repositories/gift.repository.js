import BaseRepository from './base.repository.js';
import Gift from '../modules/gift.model.js';

class GiftRepository extends BaseRepository {
  constructor() {
    super(Gift);
  }
}

export default new GiftRepository();
