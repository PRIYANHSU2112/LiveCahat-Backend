import mongoose from 'mongoose';
import 'dotenv/config';
import User from '../src/modules/user.model.js';
import { generateToken } from '../src/utils/jwt.util.js';

async function checkError() {
  await mongoose.connect(process.env.DATABASE_URI);
  const user = await User.findById('6a6ad957593cc00e75d08740');
  const token = generateToken({ id: user._id.toString(), type: user.type });
  const res = await fetch('http://localhost:5000/api/v1/match/around-you?limit=10', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response JSON:', JSON.stringify(data, null, 2));

  const resForYou = await fetch('http://localhost:5000/api/v1/match/discover?limit=10', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('\nFor You Status:', resForYou.status);
  const dataForYou = await resForYou.json();
  console.log('For You JSON keys:', Object.keys(dataForYou));
  console.log('For You data keys:', Object.keys(dataForYou.data || {}));
  console.log('For You listeners count:', dataForYou.data?.listeners?.length || dataForYou.data?.items?.length || 0);

  await mongoose.disconnect();
}

checkError().catch(console.error);
