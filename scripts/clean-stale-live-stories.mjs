import mongoose from 'mongoose';
import '../src/server.js';

setTimeout(async () => {
  try {
    const Story = mongoose.model('Story');
    const LiveRoom = mongoose.model('LiveRoom');
    const activeRooms = await LiveRoom.find({ status: 'live' });
    const activeRoomIds = activeRooms.map(r => r._id);
    const res = await Story.updateMany(
      { type: 'LIVE', status: 'ACTIVE', liveSessionId: { $nin: activeRoomIds } },
      { status: 'ENDED' }
    );
    console.log('✅ Cleaned stale live stories:', res.modifiedCount);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error cleaning live stories:', err);
    process.exit(1);
  }
}, 3000);
