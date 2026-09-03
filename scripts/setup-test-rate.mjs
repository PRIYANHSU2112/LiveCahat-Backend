import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';

async function main() {
  const conn = await mongoose.createConnection(uri).asPromise();
  const res = await conn.collection('listenerprofiles').updateOne(
    { userId: new mongoose.Types.ObjectId('6a99229fed906a35b16b1f17') },
    { $set: { chatRate: 10 } }
  );
  console.log(`Updated listener chatRate to 10. Modified: ${res.modifiedCount}`);
  await conn.close();
}

main().catch(console.error);
