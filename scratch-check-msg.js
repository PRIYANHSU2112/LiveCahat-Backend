import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';

async function run() {
  try {
    await mongoose.connect(DB_URI);
    const db = mongoose.connection.db;

    const messageIdStr = '6a7e974a7ce50bedeb810b19';
    const msg = await db.collection('chatmessages').findOne({ _id: new mongoose.Types.ObjectId(messageIdStr) });
    console.log('--- TARGET MESSAGE ---');
    console.log(JSON.stringify(msg, null, 2));

    if (!msg) {
      console.log('Message 6a7e974a7ce50bedeb810b19 NOT FOUND in MongoDB!');
      console.log('--- 5 SAMPLE MESSAGES IN DB ---');
      const samples = await db.collection('chatmessages').find().limit(5).toArray();
      console.log(JSON.stringify(samples, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
