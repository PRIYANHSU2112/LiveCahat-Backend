import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';

async function main() {
  const conn = await mongoose.createConnection(uri).asPromise();
  
  // Set names for test customer and listener
  await conn.collection('users').updateOne(
    { _id: new mongoose.Types.ObjectId('6a99229fed906a35b16b1f17') },
    { $set: { firstName: 'Aarav', lastName: 'Listener' } }
  );

  await conn.collection('users').updateOne(
    { _id: new mongoose.Types.ObjectId('6a99229eed906a35b16b1f12') },
    { $set: { firstName: 'Rahul', lastName: 'Customer' } }
  );

  console.log('Updated test users firstName and lastName successfully!');
  await conn.close();
}

main().catch(console.error);
