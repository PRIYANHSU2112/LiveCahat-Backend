import BaseRepository from './base.repository.js';
import Sticker from '../modules/sticker.model.js';

class StickerRepository extends BaseRepository {
  constructor() {
    super(Sticker);
  }
}

export default new StickerRepository();
