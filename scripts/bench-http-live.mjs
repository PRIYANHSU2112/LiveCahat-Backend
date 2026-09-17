import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import User from '../src/modules/user.model.js';

dotenv.config();

const MONGO_URI = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change_in_production';
const BASE_URL = 'http://localhost:5000';

async function runHttpBenchmark() {
  console.log('Connecting to Mongo to fetch valid customer user...');
  await mongoose.connect(MONGO_URI);
  let user = await User.findOne({ type: 'CUSTOMER' }).lean();
  if (!user) {
    user = await User.findOne({}).lean();
  }
  await mongoose.disconnect();

  const token = jwt.sign(
    { id: user._id.toString(), role: user.type || 'CUSTOMER', tokenType: 'access' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  console.log(`Generated JWT for user: ${user._id} (${user.type || 'CUSTOMER'})`);
  console.log(`Testing HTTP Endpoints on ${BASE_URL}...\n`);

  const results = [];

  async function testEndpoint(label, path, headers = {}) {
    const url = `${BASE_URL}${path}`;
    const start = performance.now();
    const res = await fetch(url, { headers });
    const end = performance.now();
    const latency = Math.round((end - start) * 100) / 100;
    const json = await res.json().catch(() => null);
    
    const count = json?.data?.docs?.length || json?.data?.length || 0;
    const nextCursor = json?.data?.meta?.nextCursor || json?.meta?.nextCursor || json?.data?.nextCursor ? 'yes' : 'no';
    const status = res.status;
    const under100 = latency < 100 ? '✅ YES' : '❌ NO';

    results.push({
      Endpoint: label,
      Path: path.length > 35 ? `${path.slice(0, 35)}...` : path,
      Status: status,
      'Latency (ms)': latency,
      'Items': count,
      'Under 100ms': under100,
    });

    console.log(`[${status}] ${label.padEnd(32)} -> ${latency}ms (count: ${count}, nextCursor: ${nextCursor})`);
    return { json, latency };
  }

  const authHeader = { Authorization: `Bearer ${token}` };

  console.log('--- 1. Testing GET /api/v1/home/user-home ---');
  // Cold & Warm Default
  const { json: h1 } = await testEndpoint('Home Feed (Cold / DB Query)', `/api/v1/home/user-home?limit=10&_bust=${Date.now()}`, authHeader);
  await testEndpoint('Home Feed (Warm / Redis Hit)', '/api/v1/home/user-home?limit=10', authHeader);

  // Filter status ONLINE (Cold & Warm)
  await testEndpoint('Home Feed (Filter: ONLINE Cold)', `/api/v1/home/user-home?limit=10&status=ONLINE&_bust=${Date.now()}`, authHeader);
  await testEndpoint('Home Feed (Filter: ONLINE Warm)', '/api/v1/home/user-home?limit=10&status=ONLINE', authHeader);

  // Filter sort popular (Cold & Warm)
  await testEndpoint('Home Feed (Filter: sort=popular Cold)', `/api/v1/home/user-home?limit=10&sort=popular&_bust=${Date.now()}`, authHeader);
  await testEndpoint('Home Feed (Filter: sort=popular Warm)', '/api/v1/home/user-home?limit=10&sort=popular', authHeader);

  // Cursor Next Page (Cold & Warm)
  const homeCursor = h1?.data?.meta?.nextCursor;
  if (homeCursor) {
    await testEndpoint('Home Feed (Cursor Next Page Cold)', `/api/v1/home/user-home?limit=10&cursor=${homeCursor}&_bust=${Date.now()}`, authHeader);
    await testEndpoint('Home Feed (Cursor Next Page Warm)', `/api/v1/home/user-home?limit=10&cursor=${homeCursor}`, authHeader);
  }

  console.log('\n--- 2. Testing GET /api/v1/match/discover ---');
  // Cold & Warm Default
  const { json: d1 } = await testEndpoint('Discover Feed (Cold / DB Query)', `/api/v1/match/discover?limit=10&_bust=${Date.now()}`, authHeader);
  await testEndpoint('Discover Feed (Warm / Redis Hit)', '/api/v1/match/discover?limit=10', authHeader);

  // Filter sort rating (Cold & Warm)
  await testEndpoint('Discover Feed (Filter: rating Cold)', `/api/v1/match/discover?limit=10&sort=rating&_bust=${Date.now()}`, authHeader);
  await testEndpoint('Discover Feed (Filter: rating Warm)', '/api/v1/match/discover?limit=10&sort=rating', authHeader);

  // Filter status ONLINE (Cold & Warm)
  await testEndpoint('Discover Feed (Filter: ONLINE Cold)', `/api/v1/match/discover?limit=10&status=ONLINE&_bust=${Date.now()}`, authHeader);
  await testEndpoint('Discover Feed (Filter: ONLINE Warm)', '/api/v1/match/discover?limit=10&status=ONLINE', authHeader);

  // Cursor Next Page (Cold & Warm)
  const discCursor = d1?.data?.nextCursor || d1?.meta?.nextCursor;
  if (discCursor) {
    await testEndpoint('Discover Feed (Cursor Next Page Cold)', `/api/v1/match/discover?limit=10&cursor=${discCursor}&_bust=${Date.now()}`, authHeader);
    await testEndpoint('Discover Feed (Cursor Next Page Warm)', `/api/v1/match/discover?limit=10&cursor=${discCursor}`, authHeader);
  }

  console.log('\n================ FINAL HTTP BENCHMARK SUMMARY ================');
  console.table(results);
}

runHttpBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
