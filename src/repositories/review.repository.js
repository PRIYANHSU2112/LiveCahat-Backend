import BaseRepository from './base.repository.js';
import Review from '../modules/review.model.js';

class ReviewRepository extends BaseRepository {
  constructor() {
    super(Review);
  }
}

export default new ReviewRepository();
