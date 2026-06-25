import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/modules/user.model.js';
import listenerService from './src/services/listener.service.js';

dotenv.config();
const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

async function main() {
  await mongoose.connect(DB_URI);
  console.log('Connected to DB!');
  
  const agent = await User.findOne({ email: 'agent@chatcorner.app', type: 'AGENT' });
  if (!agent) {
    console.log('No agent user found in DB!');
    process.exit(1);
  }
  
  console.log(`Found Agent User ID: ${agent._id}`);
  
  const stats = await listenerService.getAgentStats(agent._id);
  console.log('Agent Stats Output:');
  console.log(JSON.stringify(stats, null, 2));
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
