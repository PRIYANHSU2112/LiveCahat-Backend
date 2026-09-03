import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';

async function recharge(userId, amount = 1000) {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const res = await db.collection('wallets').updateOne(
    { userId: new mongoose.Types.ObjectId(userId) },
    { $set: { coinBalance: amount } },
    { upsert: true }
  );
  console.log(`Recharged userId=${userId} to ${amount} coins. Modified: ${res.modifiedCount}, Upserted: ${res.upsertedCount}`);
  await mongoose.disconnect();
}

const targetUserId = process.argv[2] || '6a99229eed906a35b16b1f12';
const coins = parseInt(process.argv[3], 10) || 1000;
recharge(targetUserId, coins).catch(console.error);
