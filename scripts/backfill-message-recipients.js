import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const DB_URI = process.env.DATABASE_URI;

async function backfill() {
  if (!DB_URI) {
    console.error('DATABASE_URI not found in environment!');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(DB_URI);
    console.log('Connected.');

    const db = mongoose.connection.db;
    const chatmessages = db.collection('chatmessages');
    const communicationsessions = db.collection('communicationsessions');

    // Find all messages where recipientId is missing or null and sessionId exists
    const missingRecipientMsgs = await chatmessages.find({
      $or: [{ recipientId: { $exists: false } }, { recipientId: null }],
      sessionId: { $ne: null }
    }).toArray();

    console.log(`Found ${missingRecipientMsgs.length} messages with missing recipientId.`);

    let updatedCount = 0;
    const sessionCache = new Map();

    for (const msg of missingRecipientMsgs) {
      const sIdStr = msg.sessionId.toString();
      let session = sessionCache.get(sIdStr);

      if (!session) {
        session = await communicationsessions.findOne({ _id: msg.sessionId });
        if (session) {
          sessionCache.set(sIdStr, session);
        }
      }

      if (session) {
        const callerIdStr = session.callerId ? session.callerId.toString() : '';
        const listenerIdStr = session.listenerId ? session.listenerId.toString() : '';
        const senderIdStr = msg.senderId ? msg.senderId.toString() : '';

        let recipientId = null;
        if (senderIdStr === callerIdStr) {
          recipientId = session.listenerId;
        } else if (senderIdStr === listenerIdStr) {
          recipientId = session.callerId;
        }

        if (recipientId) {
          await chatmessages.updateOne(
            { _id: msg._id },
            { $set: { recipientId: new mongoose.Types.ObjectId(recipientId) } }
          );
          updatedCount++;
        }
      }
    }

    console.log(`Successfully backfilled recipientId for ${updatedCount} messages.`);
    process.exit(0);
  } catch (err) {
    console.error('Backfill error:', err);
    process.exit(1);
  }
}

backfill();
