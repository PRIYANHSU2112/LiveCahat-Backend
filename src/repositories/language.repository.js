import BaseRepository from './base.repository.js';
import Language from '../modules/language.model.js';

class LanguageRepository extends BaseRepository {
  constructor() {
    super(Language);
  }
}

export default new LanguageRepository();
