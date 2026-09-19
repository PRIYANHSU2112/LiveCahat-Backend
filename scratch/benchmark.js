import mongoose from 'mongoose';
import 'dotenv/config';
import User from '../src/modules/user.model.js';
import { generateToken } from '../src/utils/jwt.util.js';

async function run() {
  const uri = process.env.DATABASE_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);
  console.log('MongoDB Connected');

  let customer = await User.findOne({ type: 'CUSTOMER', isDeleted: { $ne: true } });
  if (!customer) {
    customer = await User.create({
      type: 'CUSTOMER',
      firstName: 'Test',
      lastName: 'MobileUser',
      mobileNumber: '9999988888',
      profileCompleted: true,
    });
  }

  const token = generateToken({ id: customer._id.toString(), type: customer.type });
  console.log(`Using Customer: ${customer.firstName} ${customer.lastName} (${customer._id})`);
  console.log(`Token generated.`);

  const baseUrl = 'http://localhost:5000/api/v1';

  async function testApi(name, path) {
    const times = [];
    let lastData = null;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const res = await fetch(`${baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const duration = performance.now() - start;
      times.push(duration);
      const json = await res.json();
      if (i === 0) lastData = json;
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { name, times, avg, min, max, count: lastData?.data?.listeners?.length || 0, sample: lastData?.data?.listeners?.[0] };
  }

  console.log('\n--- Benchmarking APIs ---');
  const forYouResults = await testApi('For You (/match/discover)', '/match/discover?limit=10');
  const aroundYouResults = await testApi('Around You (/match/around-you)', '/match/around-you?limit=10');

  console.log('\n================ BENCHMARK RESULTS ================');
  console.log(`Endpoint: ${forYouResults.name}`);
  console.log(`  Items returned: ${forYouResults.count}`);
  console.log(`  Latencies: ${forYouResults.times.map(t => t.toFixed(1) + 'ms').join(', ')}`);
  console.log(`  Min: ${forYouResults.min.toFixed(1)}ms | Avg: ${forYouResults.avg.toFixed(1)}ms`);
  if (forYouResults.sample) {
    console.log(`  Top listener: ${forYouResults.sample.fullName} (Rating: ${forYouResults.sample.avgRating}, Level: ${forYouResults.sample.level})`);
  }

  console.log(`\nEndpoint: ${aroundYouResults.name}`);
  console.log(`  Items returned: ${aroundYouResults.count}`);
  console.log(`  Latencies: ${aroundYouResults.times.map(t => t.toFixed(1) + 'ms').join(', ')}`);
  console.log(`  Min: ${aroundYouResults.min.toFixed(1)}ms | Avg: ${aroundYouResults.avg.toFixed(1)}ms`);
  if (aroundYouResults.sample) {
    console.log(`  Top listener: ${aroundYouResults.sample.fullName} (Rating: ${aroundYouResults.sample.avgRating}, Sessions: ${aroundYouResults.sample.totalSessions})`);
  }

  console.log('\n=== Sub-100ms Goal Assessment ===');
  const isAroundUnder100 = aroundYouResults.avg < 100;
  console.log(`Around You Avg Response Time: ${aroundYouResults.avg.toFixed(1)}ms -> Under 100ms: ${isAroundUnder100 ? 'YES (PASSED)' : 'NO'}`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
