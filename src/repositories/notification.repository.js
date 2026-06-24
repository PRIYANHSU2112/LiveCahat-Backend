import BaseRepository from './base.repository.js';
import Notification from '../modules/notification.model.js';

class NotificationRepository extends BaseRepository {
  constructor() {
    super(Notification);
  }
}

export default new NotificationRepository();
