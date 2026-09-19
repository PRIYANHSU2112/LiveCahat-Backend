import mongoose from 'mongoose';
import 'dotenv/config';
import User from '../src/modules/user.model.js';
import ListenerProfile from '../src/modules/listener-profile.model.js';
import { generateToken } from '../src/utils/jwt.util.js';

async function inspect() {
  await mongoose.connect(process.env.DATABASE_URI);
  
  const listeners = await ListenerProfile.find().limit(5).lean();
  console.log(`Total ListenerProfiles sample: ${listeners.length}`);
  listeners.forEach(l => console.log(`Listener: ${l._id}, user: ${l.user}, status: ${l.status}, isApproved: ${l.isApproved}, isLive: ${l.isLive}`));

  const customers = await User.find({ type: 'CUSTOMER' }).limit(5).lean();
  console.log(`\nCustomers sample: ${customers.length}`);
  customers.forEach(c => console.log(`Customer: ${c._id}, phone: ${c.mobileNumber}, name: ${c.firstName} ${c.lastName}, gender: ${c.gender}`));

  // Let's test with the first real customer who has gender or profile
  const realCustomer = customers.find(c => c.firstName && c.firstName !== 'Test') || customers[0];
  console.log(`\nTesting with real customer: ${realCustomer._id} (${realCustomer.firstName})`);
  const token = generateToken({ id: realCustomer._id.toString(), type: realCustomer.type });

  const res1 = await fetch('http://localhost:5000/api/v1/match/discover?limit=10', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data1 = await res1.json();
  console.log('\n--- Real Customer Discover (For You) ---');
  console.log('Success:', data1.success, 'Count:', data1.data?.listeners?.length);
  if (data1.data?.listeners?.length) {
    console.log('Sample listener:', data1.data.listeners[0].fullName, 'Level:', data1.data.listeners[0].level);
  }

  const res2 = await fetch('http://localhost:5000/api/v1/match/around-you?limit=10', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data2 = await res2.json();
  console.log('\n--- Real Customer Around You ---');
  console.log('Success:', data2.success, 'Count:', data2.data?.listeners?.length);
  if (data2.data?.listeners?.length) {
    console.log('Sample listener:', data2.data.listeners[0].fullName, 'TotalSessions:', data2.data.listeners[0].totalSessions);
  }

  await mongoose.disconnect();
}

inspect().catch(console.error);
