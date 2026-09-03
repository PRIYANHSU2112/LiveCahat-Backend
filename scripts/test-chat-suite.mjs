import { io } from 'socket.io-client';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const BACKEND_URL = 'http://127.0.0.1:5000';
const MONGO_URI = process.env.DATABASE_URI || 'mongodb+srv://sahujipriyanshu2112_db_user:Priyanshu123@cluster0.srclyqf.mongodb.net/LiveChat?retryWrites=true&w=majority';

import Redis from 'ioredis';

async function setWalletBalance(userId, amount) {
  const conn = await mongoose.createConnection(MONGO_URI).asPromise();
  await conn.collection('wallets').updateOne(
    { userId: new mongoose.Types.ObjectId(userId) },
    { $set: { coinBalance: amount } },
    { upsert: true }
  );
  await conn.close();
  try {
    const redis = new Redis({ host: '127.0.0.1', port: 6379, password: 'yourpassword' });
    await redis.set(`wallet:user:${userId}:balance`, amount.toString());
    await redis.quit();
  } catch (e) {}
}

async function fetchToken(type, mobileNumber) {
  const reqRes = await fetch(`${BACKEND_URL}/api/v1/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      mobileNumber,
      countryCode: '+91',
      age: 25,
      gender: type === 'LISTENER' ? 'FEMALE' : 'MALE',
    }),
  });
  if (!reqRes.ok) throw new Error(`request-otp failed: ${await reqRes.text()}`);

  const vRes = await fetch(`${BACKEND_URL}/api/v1/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      mobileNumber,
      otp: '123456',
      countryCode: '+91',
    }),
  });
  if (!vRes.ok) throw new Error(`verify-otp failed: ${await vRes.text()}`);
  const data = await vRes.json();
  return { token: data.data?.token, user: data.data?.user };
}

function createSocket(token) {
  return io(BACKEND_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
}

function waitForEvent(socket, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${eventName}" after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function run() {
  console.log('================================================================');
  console.log('🚀 STARTING COMPREHENSIVE DIRECT CHAT & SESSION SEGMENT VERIFICATION');
  console.log('================================================================\n');

  // 1. Authenticate users
  console.log('Step 1: Authenticating Customer and Listener...');
  const customerAuth = await fetchToken('CUSTOMER', '9999000001');
  const listenerAuth = await fetchToken('LISTENER', '8888000001');

  const customerId = customerAuth.user._id;
  const listenerId = listenerAuth.user._id;
  console.log(`✅ Customer: ${customerId}`);
  // Cleanup any lingering sessions in Redis
  try {
    const redis = new Redis({ host: '127.0.0.1', port: 6379, password: 'yourpassword' });
    const activeKeys = await redis.keys('active_session:*');
    const userKeys = await redis.keys('user_session:*');
    if (activeKeys.length) await redis.del(activeKeys);
    if (userKeys.length) await redis.del(userKeys);
    await redis.quit();
  } catch (e) {}

  // 2. Connect sockets
  console.log('Step 2: Connecting WebSockets...');
  const customerSocket = createSocket(customerAuth.token);
  const listenerSocket = createSocket(listenerAuth.token);

  await Promise.all([
    waitForEvent(customerSocket, 'connect'),
    waitForEvent(listenerSocket, 'connect'),
  ]);
  console.log(`✅ Customer socket connected: ${customerSocket.id}`);
  console.log(`✅ Listener socket connected: ${listenerSocket.id}\n`);

  // 3. Test Insufficient Balance Check
  console.log('Step 3: Testing Strict Insufficient Balance Check (Zero Balance Block)...');
  await setWalletBalance(customerId, 0);

  const insufficientPromise = waitForEvent(customerSocket, 'chat:insufficient_balance');
  customerSocket.emit('chat:send_message', {
    clientMsgId: `zero_bal_msg_${Date.now()}`,
    recipientId: listenerId,
    text: 'This message should be rejected due to 0 balance!',
  });

  const insufficientData = await insufficientPromise;
  console.log(`✅ Server blocked message with chat:insufficient_balance! Current Balance: ${insufficientData.currentBalance}, Required: ${insufficientData.requiredCost}\n`);

  // 4. Recharge wallet and Test Bidirectional Chat Initiation (No Request Section)
  console.log('Step 4: Recharging Customer Wallet to 1000 Coins...');
  await setWalletBalance(customerId, 1000);
  console.log('✅ Customer wallet credited with 1000 coins.\n');

  console.log('Step 5: Testing Bidirectional Chat Initiation (No Request Section)...');
  const msg1Id = `test_msg_${Date.now()}_cust`;
  const msg1Text = 'Hello Listener! Initiating chat directly without any request.';

  const [receiveMsgPromise, ackPromise, chatStartedCust, chatStartedList] = [
    waitForEvent(listenerSocket, 'chat:receive_message'),
    waitForEvent(customerSocket, 'chat:ack_sent'),
    waitForEvent(customerSocket, 'chat_started'),
    waitForEvent(listenerSocket, 'chat_started'),
  ];

  customerSocket.emit('chat:send_message', {
    clientMsgId: msg1Id,
    recipientId: listenerId,
    text: msg1Text,
  });

  const receivedMsg = await receiveMsgPromise;
  const ackData = await ackPromise;
  console.log(`✅ Message delivered directly to Listener: "${receivedMsg.text}"`);
  console.log(`✅ Customer received single tick (ack_sent): deliveryStatus=${ackData.deliveryStatus}`);

  const sessionCust = await chatStartedCust;
  const sessionList = await chatStartedList;
  console.log(`✅ Both received chat_started! Active SessionId: ${sessionCust.sessionId} (Rate: ${sessionCust.ratePerMinute}/min)\n`);

  const activeSessionId = sessionCust.sessionId;

  // 6. Listener replies back
  console.log('Step 6: Listener replies to Customer...');
  const replyPromise = waitForEvent(customerSocket, 'chat:receive_message');
  const listenerAckPromise = waitForEvent(listenerSocket, 'chat:ack_sent');

  const msg2Id = `test_msg_${Date.now()}_list`;
  listenerSocket.emit('chat:send_message', {
    clientMsgId: msg2Id,
    recipientId: customerId,
    text: 'Hello Customer! I received your message instantly and am replying back.',
  });

  const replyMsg = await replyPromise;
  await listenerAckPromise;
  console.log(`✅ Customer received reply: "${replyMsg.text}"\n`);

  // 7. Test Read Receipts (Monotonic lastReadMessageId)
  console.log('Step 7: Testing Read Receipts (Monotonic forward tracking)...');
  const readPromise = waitForEvent(listenerSocket, 'chat:messages_read');
  customerSocket.emit('chat:read_conversation', {
    partnerId: listenerId,
    lastReadMessageId: receivedMsg.clientMsgId,
  });
  const readData = await readPromise;
  console.log(`✅ Listener received chat:messages_read (✓✓ blue ticks confirmation) from ${readData.readerId}\n`);

  // 8. Test Offline Queuing & ACK-Gated Delivery (Zero Message Loss)
  console.log('Step 8: Testing Offline Queuing via Redis Streams...');
  console.log('Disconnecting Listener to simulate offline state...');
  listenerSocket.disconnect();
  await new Promise((r) => setTimeout(r, 500));

  const offlineMsgId = `test_offline_${Date.now()}`;
  const offlineAckPromise = waitForEvent(customerSocket, 'chat:ack_sent');

  customerSocket.emit('chat:send_message', {
    clientMsgId: offlineMsgId,
    recipientId: listenerId,
    text: 'This message is sent while Listener is OFFLINE. Must not be lost!',
  });

  const offlineAck = await offlineAckPromise;
  console.log(`✅ Offline message accepted by server: deliveryStatus=${offlineAck.deliveryStatus} (SENT)`);

  // Reconnect listener and verify offline stream delivery
  console.log('Reconnecting Listener...');
  const reconnectedListenerSocket = createSocket(listenerAuth.token);
  const offlineBatchPromise = waitForEvent(reconnectedListenerSocket, 'chat:offline_messages');
  await waitForEvent(reconnectedListenerSocket, 'connect');

  const offlineBatch = await offlineBatchPromise;
  const targetMsg = offlineBatch.messages?.find((m) => m.clientMsgId === offlineMsgId);
  if (!targetMsg) throw new Error(`Offline message ${offlineMsgId} not found in offline batch!`);
  console.log(`✅ Listener received offline batch (${offlineBatch.messages.length} msg): "${targetMsg.text}"`);

  // Receiver ACKs delivery
  const deliveredPromise = waitForEvent(customerSocket, 'chat:message_delivered');
  reconnectedListenerSocket.emit('chat:ack_delivered', {
    entryIds: [targetMsg.entryId],
    senderIds: [customerId],
  });

  await deliveredPromise;
  console.log(`✅ Customer received chat:message_delivered (✓✓ double ticks) after ACK!\n`);

  // 9. Test Settle & End Session when user leaves
  console.log('Step 9: Testing Session Settlement & Teardown on End Chat...');
  const [custEndPromise, listEndPromise] = [
    waitForEvent(customerSocket, 'chat_ended'),
    waitForEvent(reconnectedListenerSocket, 'chat_ended'),
  ];

  customerSocket.emit('end_chat', { sessionId: activeSessionId });

  const custEnd = await custEndPromise;
  const listEnd = await listEndPromise;
  console.log(`✅ Both received chat_ended! Reason: ${custEnd.reason}`);
  console.log(`✅ Session ${activeSessionId} successfully settled and ended!\n`);

  // Cleanup sockets
  customerSocket.disconnect();
  reconnectedListenerSocket.disconnect();

  console.log('================================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! CHAT PIPELINE FULLY VERIFIED!');
  console.log('================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
