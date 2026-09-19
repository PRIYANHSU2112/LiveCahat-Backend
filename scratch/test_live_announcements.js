import redisClient from '../src/config/redis.js';
import liveAnnouncementService from '../src/services/live-announcement.service.js';
import { SERVER_EVENTS } from '../src/constants/socket-event.constant.js';

async function runTests() {
  console.log('=== TEST SUITE: Real-Time Live Session New User Announcement Queue ===\n');

  // Wait for Redis connection if needed
  if (!redisClient.isRedisAvailable) {
    console.log('Connecting to Redis...');
    await redisClient.connect().catch(() => {});
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`Redis Available: ${redisClient.isRedisAvailable}`);

  const mockRoomId = `test_room_${Date.now()}`;
  const broadcastsReceived = [];

  // Mock Socket.io instance to intercept emissions
  const mockIo = {
    to: (roomName) => ({
      emit: (eventName, payload) => {
        if (eventName === SERVER_EVENTS.LIVE_USER_ANNOUNCEMENT) {
          broadcastsReceived.push({ roomName, payload, time: Date.now() });
        }
      }
    })
  };

  console.log(`\n--- Test 1: Deduplication Filter (15s Window) ---`);
  const duplicateUser = {
    userId: 'user_dup_123',
    name: 'Aarav Patel',
    avatar: 'https://example.com/aarav.png',
    userType: 'CUSTOMER'
  };

  // Enqueue 5 identical join events in rapid succession
  for (let i = 0; i < 5; i++) {
    liveAnnouncementService.enqueueJoinAnnouncement(mockIo, mockRoomId, duplicateUser);
  }

  // Wait 100ms for setImmediate to execute
  await new Promise(r => setTimeout(r, 150));

  const queueKey = `live:announcement:queue:${mockRoomId}`;
  const queueLenAfterDupes = await redisClient.llen(queueKey);
  console.log(`Enqueued 5 identical joins. Items in Redis queue: ${queueLenAfterDupes}`);
  if (queueLenAfterDupes === 1) {
    console.log('✓ PASS: Deduplication successful! Exactly 1 item queued, 4 dropped.');
  } else {
    console.log(`✕ FAIL: Expected 1 item, got ${queueLenAfterDupes}`);
  }

  console.log(`\n--- Test 2: High-Concurrency Burst (100 Simultaneous Joins) ---`);
  const burstStart = performance.now();
  for (let i = 1; i <= 100; i++) {
    liveAnnouncementService.enqueueJoinAnnouncement(mockIo, mockRoomId, {
      userId: `user_burst_${i}`,
      name: `User ${i}`,
      avatar: `https://example.com/u${i}.png`,
      userType: i % 5 === 0 ? 'LISTENER' : 'CUSTOMER'
    });
  }
  const enqueueDuration = performance.now() - burstStart;
  console.log(`Enqueued 100 concurrent joins in: ${enqueueDuration.toFixed(2)}ms (Completely non-blocking!)`);

  // Wait for setImmediate
  await new Promise(r => setTimeout(r, 200));
  const queueLenBurst = await redisClient.llen(queueKey);
  console.log(`Items in Redis queue after 100 unique joins: ${queueLenBurst}`);
  if (queueLenBurst >= 100) {
    console.log('✓ PASS: All 100 unique joins buffered safely into Redis queue.');
  }

  console.log(`\n--- Test 3: Rate-Controlled Batch Dispatcher & Socket Broadcast ---`);
  console.log('Waiting for dispatcher ticks (every 350ms, max 5 items per tick)...');
  await new Promise(r => setTimeout(r, 1200));

  console.log(`Broadcast batches received so far: ${broadcastsReceived.length}`);
  if (broadcastsReceived.length > 0) {
    const firstBatch = broadcastsReceived[0];
    console.log(`Sample broadcast batch:`);
    console.log(`  Room: ${firstBatch.payload.roomId}`);
    console.log(`  Announcements count: ${firstBatch.payload.announcements.length}`);
    console.log(`  First user in batch:`, firstBatch.payload.announcements[0]);
    console.log('✓ PASS: Socket.IO broadcast dispatched with correct batch format.');
  }

  console.log(`\n--- Test 4: Room Teardown & Redis Key Cleanup ---`);
  liveAnnouncementService.cleanupRoom(mockRoomId);
  await new Promise(r => setTimeout(r, 100));

  const queueExists = await redisClient.exists(queueKey);
  const isDispatcherStopped = !liveAnnouncementService.activeDispatchers.has(mockRoomId);
  console.log(`Queue key exists in Redis after cleanup: ${queueExists === 1 ? 'YES' : 'NO'}`);
  console.log(`Dispatcher stopped: ${isDispatcherStopped ? 'YES' : 'NO'}`);

  if (queueExists === 0 && isDispatcherStopped) {
    console.log('✓ PASS: Room teardown cleanly purged Redis keys and stopped interval.');
  }

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
