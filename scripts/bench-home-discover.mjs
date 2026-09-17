import mongoose from 'mongoose';
import dotenv from 'dotenv';
import redisClient, { connectRedis } from '../src/config/redis.js';
import listenerService from '../src/services/listener.service.js';
import matchService from '../src/services/match.service.js';

dotenv.config();

const MONGO_URI = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';

async function runBenchmark() {
  console.log('Connecting to MongoDB & Redis...');
  await mongoose.connect(MONGO_URI);
  await connectRedis();
  console.log('MongoDB & Redis Connected.');

  const customer = {
    _id: new mongoose.Types.ObjectId(),
    country: 'IN',
    countryCode: 'IN',
  };

  const results = [];

  async function timeCall(label, fn) {
    const start = performance.now();
    const res = await fn();
    const end = performance.now();
    const ms = Math.round((end - start) * 100) / 100;
    const count = res?.docs?.length || res?.data?.length || 0;
    const nextCursor = res?.meta?.nextCursor ? 'yes' : 'no';
    results.push({
      Test: label,
      'Latency (ms)': ms,
      'Items': count,
      'Next Cursor': nextCursor,
      'Under 100ms': ms < 100 ? '✅ YES' : '❌ NO',
    });
    console.log(`[${label}]: ${ms}ms (${count} items, nextCursor: ${nextCursor})`);
    return { res, ms };
  }

  console.log('\n--- 1. Testing Home API (getHomeListeners) ---');
  // 1. Cold Cache / Cache Miss
  const { res: home1 } = await timeCall('Home Feed (Cold / DB Query)', () =>
    listenerService.getHomeListeners({ limit: 10, _bust: Date.now() })
  );

  // 2. Warm Cache / Redis Hit
  await timeCall('Home Feed (Warm / Redis Cache Hit)', () =>
    listenerService.getHomeListeners({ limit: 10 })
  );

  // 3. Filter: status=ONLINE (Cold)
  await timeCall('Home Feed (Filter: status=ONLINE, Cold)', () =>
    listenerService.getHomeListeners({ status: 'ONLINE', limit: 10, _bust: Date.now() })
  );

  // 4. Filter: status=ONLINE (Warm)
  await timeCall('Home Feed (Filter: status=ONLINE, Warm)', () =>
    listenerService.getHomeListeners({ status: 'ONLINE', limit: 10 })
  );

  // 5. Filter: sort=popular
  await timeCall('Home Feed (Filter: sort=popular)', () =>
    listenerService.getHomeListeners({ sort: 'popular', limit: 10 })
  );

  // 6. Cursor Keyset Pagination
  const nextCursor = home1?.meta?.nextCursor;
  if (nextCursor) {
    await timeCall('Home Feed (Cursor Next Page Seek)', () =>
      listenerService.getHomeListeners({ cursor: nextCursor, limit: 10 })
    );
  }

  console.log('\n--- 2. Testing Discover API (discoverListeners) ---');
  // 1. Cold Cache / Cache Miss
  const { res: disc1 } = await timeCall('Discover Feed (Cold / DB Query)', () =>
    matchService.discoverListeners(customer, { limit: 10, _bust: Date.now() })
  );

  // 2. Warm Cache / Redis Hit
  await timeCall('Discover Feed (Warm / Redis Cache Hit)', () =>
    matchService.discoverListeners(customer, { limit: 10 })
  );

  // 3. Filter: sort=rating
  await timeCall('Discover Feed (Filter: sort=rating, Cold)', () =>
    matchService.discoverListeners(customer, { sort: 'rating', limit: 10, _bust: Date.now() })
  );

  // 4. Filter: sort=rating (Warm)
  await timeCall('Discover Feed (Filter: sort=rating, Warm)', () =>
    matchService.discoverListeners(customer, { sort: 'rating', limit: 10 })
  );

  // 5. Cursor Keyset Pagination
  const discCursor = disc1?.meta?.nextCursor;
  if (discCursor) {
    await timeCall('Discover Feed (Cursor Next Page Seek)', () =>
      matchService.discoverListeners(customer, { cursor: discCursor, limit: 10 })
    );
  }

  console.log('\n================ FINAL LATENCY RESULTS ================');
  console.table(results);

  await mongoose.disconnect();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
