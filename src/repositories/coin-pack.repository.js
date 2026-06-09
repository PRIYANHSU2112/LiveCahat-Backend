import BaseRepository from './base.repository.js';
import CoinPack from '../modules/coin-pack.model.js';

class CoinPackRepository extends BaseRepository {
  constructor() {
    super(CoinPack);
  }
}

export default new CoinPackRepository();
