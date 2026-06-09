import coinPackRepository from '../repositories/coin-pack.repository.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

class CoinPackService {
  async createCoinPack(data) {
    const coinPack = await coinPackRepository.create(data);
    await bumpCacheVersion('coin_packs');
    return coinPack;
  }

  async getAllCoinPacks(query = {}, forAdmin = false) {
    // Only use cache for user-facing lists (isActive = true), admin can skip cache or cache separate lists.
    // For users, fast responses matter most.
    if (!forAdmin) {
      const version = await getCacheVersion('coin_packs');
      const cacheKey = `coin_packs:list:active:v${version}`;
      
      const cachedData = await getCache(cacheKey);
      if (cachedData) return cachedData;

      const filter = { isActive: true };
      const coinPacks = await coinPackRepository.findMany(filter, '', '', { price: 1 });
      
      await setCache(cacheKey, coinPacks, 3600); // Cache for 1 hour
      return coinPacks;
    }

    // For Admin: Support query parameters (no caching needed as admin fetches rarely and needs real-time data)
    const filter = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    
    return await coinPackRepository.findMany(filter, '', '', { price: 1 });
  }

  async getCoinPackById(id) {
    const cacheKey = `coin_pack:${id}`;
    const cachedPack = await getCache(cacheKey);
    if (cachedPack) return cachedPack;

    const coinPack = await coinPackRepository.findById(id);
    if (!coinPack) throw new ApiError(404, 'Coin pack not found');

    await setCache(cacheKey, coinPack, 3600); // 1 hour cache
    return coinPack;
  }

  async updateCoinPack(id, data) {
    const updatedCoinPack = await coinPackRepository.updateById(id, data);
    if (!updatedCoinPack) throw new ApiError(404, 'Coin pack not found');

    await Promise.all([
      deleteCache(`coin_pack:${id}`),
      bumpCacheVersion('coin_packs')
    ]);

    return updatedCoinPack;
  }

  async toggleCoinPackStatus(id) {
    // Atomic toggle using findByIdAndUpdate with an aggregation pipeline
    const updatedCoinPack = await coinPackRepository.updateById(
      id,
      [{ $set: { isActive: { $not: "$isActive" } } }],
      { new: true }
    );

    if (!updatedCoinPack) throw new ApiError(404, 'Coin pack not found');

    await Promise.all([
      deleteCache(`coin_pack:${id}`),
      bumpCacheVersion('coin_packs')
    ]);

    return updatedCoinPack;
  }

  async deleteCoinPack(id) {
    const deletedCoinPack = await coinPackRepository.deleteById(id);
    if (!deletedCoinPack) throw new ApiError(404, 'Coin pack not found');

    await Promise.all([
      deleteCache(`coin_pack:${id}`),
      bumpCacheVersion('coin_packs')
    ]);

    return deletedCoinPack;
  }
}

export default new CoinPackService();
