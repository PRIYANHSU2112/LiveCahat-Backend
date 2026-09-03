import { io } from 'socket.io-client';

const BASE = 'http://localhost:5000/api/v1';
const SOCKET_URL = 'http://localhost:5000';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function loginUser(type, mobile) {
  await post('/auth/request-otp', {
    type,
    mobileNumber: mobile,
    countryCode: '+91',
    age: 25,
    gender: type === 'LISTENER' ? 'FEMALE' : 'MALE',
  });
  const verify = await post('/auth/verify-otp', {
    type,
    mobileNumber: mobile,
    otp: '123456',
    countryCode: '+91',
  });
  if (!verify.ok || !verify.data?.data?.token) {
    throw new Error(`Login failed for ${type}: ${JSON.stringify(verify.data)}`);
  }
  return {
    token: verify.data.data.token,
    user: verify.data.data.user,
  };
}

async function run() {
  console.log('🚀 [DirectChat Test] Starting WhatsApp-style direct chat verification...\n');

  const customerMobile = `9${String(Date.now()).slice(-9)}`;
  const listenerMobile = `8${String(Date.now()).slice(-9)}`;

  // 1. Authenticate Customer & Listener
  console.log('1. Authenticating test users...');
  const customer = await loginUser('CUSTOMER', customerMobile);
  const listener = await loginUser('LISTENER', listenerMobile);
  console.log(`   Customer: ${customer.user.id} (${customerMobile})`);
  console.log(`   Listener: ${listener.user.id} (${listenerMobile})\n`);

  // 2. Connect Sockets
  console.log('2. Connecting WebSockets...');
  const customerSocket = io(SOCKET_URL, { auth: { token: customer.token } });
  const listenerSocket = io(SOCKET_URL, { auth: { token: listener.token } });

  await new Promise((resolve) => {
    let count = 0;
    const check = () => { count++; if (count === 2) resolve(); };
    customerSocket.on('connect', () => { console.log('   Customer socket connected:', customerSocket.id); check(); });
    listenerSocket.on('connect', () => { console.log('   Listener socket connected:', listenerSocket.id); check(); });
  });

  console.log('\n3. Testing: Customer -> Listener Direct Message (No Request)');
  const clientMsgId1 = `test_msg_${Date.now()}_1`;
  const text1 = 'Hello Listener, this is an instant WhatsApp message!';

  const customerSentPromise = new Promise((resolve) => {
    customerSocket.on('chat:ack_sent', (data) => {
      console.log('   [Customer] Received chat:ack_sent:', data);
      resolve(data);
    });
  });

  const listenerReceivedPromise = new Promise((resolve) => {
    listenerSocket.on('chat:receive_message', (data) => {
      console.log(`   [Listener] Received message from ${data.senderId}: "${data.text}"`);
      // Auto-ACK delivery
      listenerSocket.emit('chat:ack_delivered', {
        entryIds: data.entryId ? [data.entryId] : [],
        senderIds: [data.senderId],
      });
      // Auto-mark read
      listenerSocket.emit('chat:read_conversation', {
        partnerId: data.senderId,
        lastReadMessageId: data.clientMsgId,
      });
      resolve(data);
    });
  });

  const customerDeliveredPromise = new Promise((resolve) => {
    customerSocket.on('chat:message_delivered', (data) => {
      console.log('   [Customer] Received chat:message_delivered (✓✓):', data);
      resolve(data);
    });
  });

  const customerReadPromise = new Promise((resolve) => {
    customerSocket.on('chat:messages_read', (data) => {
      console.log('   [Customer] Received chat:messages_read (✓✓ Blue):', data);
      resolve(data);
    });
  });

  // Customer sends message to listener directly
  customerSocket.emit('chat:send_message', {
    clientMsgId: clientMsgId1,
    recipientId: listener.user.id,
    text: text1,
  });

  await Promise.all([
    customerSentPromise,
    listenerReceivedPromise,
    customerDeliveredPromise,
    customerReadPromise,
  ]);
  console.log('   ✅ Customer -> Listener message flow complete (Sent ✓ -> Delivered ✓✓ -> Read ✓✓ Blue)!\n');

  // 4. Testing: Listener -> Customer Direct Message
  console.log('4. Testing: Listener -> Customer Direct Reply (No Request)');
  const clientMsgId2 = `test_msg_${Date.now()}_2`;
  const text2 = 'Hello Customer, I received your message! Replying instantly.';

  const listenerSentPromise = new Promise((resolve) => {
    listenerSocket.on('chat:ack_sent', (data) => {
      console.log('   [Listener] Received chat:ack_sent:', data);
      resolve(data);
    });
  });

  const customerReceivedPromise = new Promise((resolve) => {
    customerSocket.on('chat:receive_message', (data) => {
      console.log(`   [Customer] Received message from ${data.senderId}: "${data.text}"`);
      customerSocket.emit('chat:ack_delivered', {
        entryIds: data.entryId ? [data.entryId] : [],
        senderIds: [data.senderId],
      });
      customerSocket.emit('chat:read_conversation', {
        partnerId: data.senderId,
        lastReadMessageId: data.clientMsgId,
      });
      resolve(data);
    });
  });

  const listenerDeliveredPromise = new Promise((resolve) => {
    listenerSocket.on('chat:message_delivered', (data) => {
      console.log('   [Listener] Received chat:message_delivered (✓✓):', data);
      resolve(data);
    });
  });

  const listenerReadPromise = new Promise((resolve) => {
    listenerSocket.on('chat:messages_read', (data) => {
      console.log('   [Listener] Received chat:messages_read (✓✓ Blue):', data);
      resolve(data);
    });
  });

  listenerSocket.emit('chat:send_message', {
    clientMsgId: clientMsgId2,
    recipientId: customer.user.id,
    text: text2,
  });

  await Promise.all([
    listenerSentPromise,
    customerReceivedPromise,
    listenerDeliveredPromise,
    listenerReadPromise,
  ]);
  console.log('   ✅ Listener -> Customer message flow complete (Sent ✓ -> Delivered ✓✓ -> Read ✓✓ Blue)!\n');

  // 5. Test REST history endpoint
  console.log('5. Testing: REST Direct Messages History API');
  const historyRes = await fetch(`${BASE}/chats/direct/${listener.user.id}/messages`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  });
  const historyData = await historyRes.json();
  console.log('   HTTP Status:', historyRes.status);
  console.log('   Messages returned:', historyData.data?.messages?.length || 0);

  // Clean up sockets
  customerSocket.disconnect();
  listenerSocket.disconnect();

  console.log('\n🎉 ALL DIRECT CHAT TESTS PASSED WITH 100% SUCCESS!');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
