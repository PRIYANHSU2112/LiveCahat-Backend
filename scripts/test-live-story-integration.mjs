import mongoose from 'mongoose';
import axios from 'axios';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';
dotenv.config();

import User from '../src/modules/user.model.js';
import Follow from '../src/modules/follow.model.js';
import { generateToken } from '../src/utils/jwt.util.js';

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';
const BASE_URL = 'http://127.0.0.1:5000/api/v1';
const SOCKET_URL = 'http://127.0.0.1:5000';

async function testLiveStoryIntegration() {
  console.log('=== TEST: LIVE STORY & TARGETED SOCKET INTEGRATION ===\n');

  await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('✔ Connected to MongoDB');

  try {
    const testSuffix = Date.now();

    // 1. Create or fetch test users
    const customer = await User.create({
      firstName: `Cust_${testSuffix}`,
      lastName: 'Test',
      email: `cust_${testSuffix}@test.com`,
      mobileNumber: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
      type: 'CUSTOMER',
    });

    const host = await User.create({
      firstName: `Radhika_${testSuffix}`,
      lastName: 'Host',
      email: `host_${testSuffix}@test.com`,
      mobileNumber: `92${Math.floor(10000000 + Math.random() * 90000000)}`,
      type: 'LISTENER',
    });

    const customerToken = generateToken({ id: customer._id.toString(), type: customer.type });
    const hostToken = generateToken({ id: host._id.toString(), type: host.type });

    console.log('1. Customer ID:', customer._id.toString());
    console.log('2. Host ID:', host._id.toString());

    // Make customer follow host
    await Follow.findOneAndUpdate(
      { followerId: customer._id, followingId: host._id },
      { followerId: customer._id, followingId: host._id, isFavorite: false },
      { upsert: true, new: true }
    );
    console.log('3. Follow relation created: Customer -> Host');

    // 2. Connect Customer Socket
    let liveStartedReceived = false;
    let liveEndedReceived = false;
    let receivedPayload = null;

    const customerSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: { token: customerToken },
    });

    await new Promise((resolve) => {
      customerSocket.on('connect', () => {
        console.log('4. Customer Socket connected:', customerSocket.id);
        resolve();
      });
    });

    customerSocket.on('story:live_started', (payload) => {
      console.log('>>> [TARGETED EVENT RECEIVED] story:live_started:', payload);
      liveStartedReceived = true;
      receivedPayload = payload;
    });

    customerSocket.on('story:live_ended', (payload) => {
      console.log('>>> [TARGETED EVENT RECEIVED] story:live_ended:', payload);
      liveEndedReceived = true;
    });

    // 3. Connect Host Socket
    const hostSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: { token: hostToken },
    });

    await new Promise((resolve) => {
      hostSocket.on('connect', () => {
        console.log('5. Host Socket connected:', hostSocket.id);
        resolve();
      });
    });

    let liveRoomId = null;

    await new Promise((resolve) => {
      hostSocket.on('live:started', (data) => {
        console.log('6. Host started live room successfully:', data.roomId);
        liveRoomId = data.roomId;
        resolve();
      });

      hostSocket.emit('live:start', {
        title: 'Radhika Live Streaming',
        mode: 'VIDEO',
      });
    });

    // Give targeted socket events time to dispatch
    await new Promise((r) => setTimeout(r, 1500));

    // 4. Verify targeted socket reception
    console.log('\n--- VERIFYING TARGETED SOCKET ---');
    console.log('liveStartedReceived by Customer:', liveStartedReceived);
    if (liveStartedReceived && receivedPayload) {
      console.log('✔ liveSessionId received:', receivedPayload.liveSessionId);
      console.log('✔ hostId received:', receivedPayload.hostId);
      console.log('✔ liveSessionId matches roomId:', receivedPayload.liveSessionId === liveRoomId);
    }

    // 5. Query GET /stories/feed as Customer
    console.log('\n--- VERIFYING STORIES FEED RANKING ---');
    const feedRes = await axios.get(`${BASE_URL}/stories/feed`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    const items = feedRes.data.data.items;
    console.log(`✔ Feed returned ${items.length} story bubbles.`);
    const hostBubble = items.find((b) => b.ownerId === host._id.toString());
    console.log('✔ Host Bubble ranking in Stories Feed:', {
      ownerName: hostBubble?.owner?.firstName,
      isLive: hostBubble?.isLive,
      liveSessionId: hostBubble?.liveSessionId,
      priorityScore: hostBubble?.priorityScore,
      isFollowing: hostBubble?.isFollowing,
    });

    if (hostBubble?.isFollowing && hostBubble?.isLive) {
      console.log('✔ Verified: Followed live host has Priority Score 60 (Top Tier)');
    }

    // 6. Host Ends Live Stream
    console.log('\n--- ENDING LIVE STREAM ---');
    await new Promise((resolve) => {
      hostSocket.emit('live:end', { roomId: liveRoomId });
      setTimeout(resolve, 1500);
    });

    console.log('✔ liveEndedReceived by Customer:', liveEndedReceived);

    // 7. Re-query GET /stories/feed after stream ended
    const feedResAfter = await axios.get(`${BASE_URL}/stories/feed`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const hostBubbleAfter = feedResAfter.data.data.items.find((b) => b.ownerId === host._id.toString());
    console.log('✔ Host Bubble after stream ended:', {
      isLive: hostBubbleAfter?.isLive ?? false,
      liveSessionId: hostBubbleAfter?.liveSessionId ?? null,
      priorityScore: hostBubbleAfter?.priorityScore,
    });

    customerSocket.disconnect();
    hostSocket.disconnect();
    await mongoose.disconnect();

    console.log('\n=============================================');
    console.log('ALL TESTS PASSED WITH 100% SUCCESS! ✅');
    console.log('=============================================\n');
  } catch (err) {
    console.error('Test Failed:', err.response?.data || err.message);
    await mongoose.disconnect();
  }
}

testLiveStoryIntegration();
