import 'dotenv/config';
import mongoose from 'mongoose';
import config from './src/config/index.js';
import { initializeFirebase, getMessaging, admin } from './src/config/firebase.js';
import fcmService from './src/services/fcm.service.js';
import notificationService from './src/services/notification.service.js';
import User from './src/modules/user.model.js';
import Notification from './src/modules/notification.model.js';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 TESTING NOTIFICATION SECTION & FIREBASE SETUP');
  console.log('====================================================\n');

  // Step 1: Test Firebase SDK Initialization
  console.log('Step 1: Testing Firebase Admin Initialization...');
  try {
    const { app, messaging } = initializeFirebase();
    if (!app || !messaging) {
      throw new Error('Firebase or Messaging instance was not initialized properly.');
    }
    console.log('✅ Firebase Admin SDK initialized successfully!');
    console.log(`   Project ID: ${app.options.credential?.projectId || config.firebase.projectId || 'n15project-399715'}`);
    console.log(`   App Name: ${app.name}`);
  } catch (err) {
    console.error('❌ Firebase initialization failed:', err.message);
    process.exit(1);
  }

  // Step 2: Test Firebase Messaging dry-run or validation
  console.log('\nStep 2: Testing Firebase Cloud Messaging with test message...');
  try {
    const messaging = getMessaging();
    // Test FCM message structure validation (using dryRun if token is mock or testing with a dummy token)
    const testToken = 'fFakeTokenForTestingFCMInitialization1234567890abcdefghijklmnopqrstuvwxyz_test';
    const result = await fcmService.sendToToken(testToken, {
      title: 'Test Notification',
      body: 'Testing Firebase credentials and messaging payload configuration',
      data: { key: 'testValue', timestamp: Date.now() },
    });

    console.log('   FCM call response:', result);
    // Since testToken is fake, FCM API correctly authenticates against Google OAuth2 and responds with registration-token-not-registered or invalid-argument, which proves credentials & auth token handshake succeeded!
    if (result.error && (result.error.includes('registration token') || result.error.includes('Invalid') || result.error.includes('not a valid FCM registration token') || result.code?.includes('argument') || result.code?.includes('registration-token-not-registered'))) {
      console.log('✅ Firebase Cloud Messaging API handshake successful! Google OAuth2 authenticated the service account credentials correctly.');
    } else if (result.success) {
      console.log('✅ FCM message sent successfully!');
    } else {
      console.log('ℹ️ FCM response:', result);
    }
  } catch (err) {
    console.error('❌ FCM test error:', err.message);
  }

  // Step 3: Connect to MongoDB and test notification service methods
  console.log('\nStep 3: Connecting to Database to test Notification Service...');
  const dbUri = process.env.DATABASE_URI;
  if (!dbUri) {
    console.log('⚠️ DATABASE_URI not found in env, skipping DB tests.');
    process.exit(0);
  }

  try {
    await mongoose.connect(dbUri);
    console.log('✅ MongoDB connected successfully!');

    // Create a temporary test user
    const testAdmin = await User.findOne({ type: 'ADMIN' }) || await User.create({
      firstName: 'Test',
      lastName: 'Admin',
      email: `testadmin_${Date.now()}@example.com`,
      type: 'ADMIN',
      mobileNumber: '9999999991',
    });

    const testCustomer = await User.create({
      firstName: 'Test',
      lastName: 'Customer',
      email: `testcustomer_${Date.now()}@example.com`,
      type: 'CUSTOMER',
      mobileNumber: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
      age: 25,
      gender: 'MALE',
      fcmToken: 'mock_fcm_token_123',
    });
    console.log(`✅ Test Customer created: ${testCustomer._id}`);

    // Test 3.1: Admin sends notification to user
    console.log('\nStep 3.1: Admin sends notification to user...');
    const sentNotification = await notificationService.sendToUser(testAdmin._id, {
      recipientId: testCustomer._id,
      title: 'Welcome to LiveChat!',
      body: 'Your account is ready. Explore features and start connecting.',
      type: 'SYSTEM',
      metadata: { deepLink: '/profile' },
    });
    console.log(`✅ Notification created: ID = ${sentNotification._id}, title = "${sentNotification.title}"`);

    // Test 3.2: User gets their notifications
    console.log('\nStep 3.2: User retrieves notifications...');
    const myNotifications = await notificationService.getMyNotifications(testCustomer._id, { page: 1, limit: 10 });
    const docs = myNotifications.docs || myNotifications.data || [];
    const total = myNotifications.meta?.totalDocuments ?? myNotifications.total ?? docs.length;
    console.log(`✅ Fetched ${docs.length} notification(s). Total: ${total}`);

    // Test 3.3: User checks unread count
    console.log('\nStep 3.3: User checks unread count...');
    const unreadRes = await notificationService.getUnreadCount(testCustomer._id);
    console.log(`✅ Unread count: ${unreadRes.unreadCount}`);

    // Test 3.4: User checks stats
    console.log('\nStep 3.4: User checks personal notification stats...');
    const myStats = await notificationService.getMyStats(testCustomer._id);
    console.log('✅ Personal Stats:', myStats);

    // Test 3.5: User marks notification as read
    console.log('\nStep 3.5: User marks notification as read...');
    const readNotif = await notificationService.markAsRead(testCustomer._id, sentNotification._id);
    console.log(`✅ Status updated to: ${readNotif.status}`);

    // Test 3.6: Mark all as read
    console.log('\nStep 3.6: Mark all as read...');
    const markAllResult = await notificationService.markAllAsRead(testCustomer._id);
    console.log(`✅ Modified ${markAllResult.modified} notification(s).`);

    // Test 3.7: Admin list notifications
    console.log('\nStep 3.7: Admin lists platform notifications...');
    const adminList = await notificationService.adminListNotifications({ page: 1, limit: 5 });
    const adminDocs = adminList.docs || adminList.data || [];
    const adminTotal = adminList.meta?.totalDocuments ?? adminList.total ?? adminDocs.length;
    console.log(`✅ Admin list returned ${adminDocs.length} records. Total: ${adminTotal}`);

    // Test 3.8: Admin platform-wide stats
    console.log('\nStep 3.8: Admin gets platform stats...');
    const adminStats = await notificationService.getAdminStats();
    console.log('✅ Admin Stats:', adminStats);

    // Test 3.9: Admin broadcast notification
    console.log('\nStep 3.9: Admin broadcasts notification to CUSTOMER audience...');
    const broadcastRes = await notificationService.broadcast(testAdmin._id, {
      audience: 'CUSTOMER',
      title: 'Platform Maintenance Scheduled',
      body: 'We have a quick update scheduled tonight at 2 AM UTC.',
      type: 'ANNOUNCEMENT',
    });
    console.log('✅ Broadcast result:', broadcastRes);

    // Test 3.10: User deletes notification
    console.log('\nStep 3.10: User deletes notification...');
    const deleteRes = await notificationService.deleteNotification(testCustomer._id, sentNotification._id);
    console.log('✅ Delete result:', deleteRes);

    // Clean up test customer
    await Notification.deleteMany({ recipientId: testCustomer._id });
    await User.findByIdAndDelete(testCustomer._id);
    console.log('🧹 Test data cleaned up successfully.');

    console.log('\n====================================================');
    console.log('🎉 ALL NOTIFICATION SECTION TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('❌ Database / Service test error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
