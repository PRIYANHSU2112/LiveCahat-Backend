import BaseRepository from './base.repository.js';
import Feedback from '../modules/feedback.model.js';

class FeedbackRepository extends BaseRepository {
  constructor() {
    super(Feedback);
  }
}

export default new FeedbackRepository();
