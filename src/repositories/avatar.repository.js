import BaseRepository from './base.repository.js';
import Avatar from '../modules/avatar.model.js';

class AvatarRepository extends BaseRepository {
  constructor() {
    super(Avatar);
  }
}

export default new AvatarRepository();
