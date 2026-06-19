import BaseRepository from './base.repository.js';
import StickerCategory from '../modules/sticker-category.model.js';

class StickerCategoryRepository extends BaseRepository {
  constructor() {
    super(StickerCategory);
  }
}

export default new StickerCategoryRepository();
