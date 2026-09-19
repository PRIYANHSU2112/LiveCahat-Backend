import mongoose from 'mongoose';
import 'dotenv/config';
import Gift from '../src/modules/gift.model.js';

async function checkGifts() {
  await mongoose.connect(process.env.DATABASE_URI);
  const gifts = await Gift.find().lean();
  console.log(`Total Gifts in DB: ${gifts.length}`);
  gifts.forEach(g => {
    console.log(`- ${g.name} | coin: ${g.coin} | icon: ${g.icon} | iconUrl: ${g.iconUrl} | active: ${g.isActive}`);
  });
  await mongoose.disconnect();
}

checkGifts().catch(console.error);
