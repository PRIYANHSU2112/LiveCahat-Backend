import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import {
  deductAndRouteMessage,
  readMailboxStream,
  ackMailboxMessages,
  updateReadPointer,
} from '../utils/chat-lua.util.js';
import { enqueueChatPersistence } from '../queues/chat-persistence.queue.js';
import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import chatMessageService from '../services/chat-message.service.js';
import mongoose from 'mongoose';
import ChatMessage from '../modules/chat-message.model.js';
import Wallet from '../modules/wallet.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import CommunicationConfig from '../modules/communication-config.model.js';
import redisClient from '../config/redis.js';
import logger from '../utils/logger.util.js';

/**
 * WhatsApp-Style Direct Chat Handler.
 *
 * Handles conversation-based messaging that works reliably whether receiver is
 * ONLINE, BUSY, or OFFLINE. Messages never get lost.
 */
class DirectChatHandler {
  /**
   * Register direct chat socket events on a connected socket.
   */
  register(io, socket) {
    socket.on(CLIENT_EVENTS.CHAT_SEND_MESSAGE, (data) => this.handleSendMessage(io, socket, data));
    socket.on('chat:join_room', (data) => this.handleJoinRoom(io, socket, data));
    socket.on('chat:leave_room', (data) => this.handleLeaveRoom(io, socket, data));
    socket.on(CLIENT_EVENTS.CHAT_ACK_DELIVERED, (data) => this.handleAckDelivered(io, socket, data));
    socket.on(CLIENT_EVENTS.CHAT_READ_CONVERSATION, (data) => this.handleReadConversation(io, socket, data));
    socket.on(CLIENT_EVENTS.CHAT_TYPING, (data) => this.handleTyping(io, socket, data));
    socket.on('chat:leave', (data) => this.handleLeaveChat(io, socket, data));
  }

  /**
   * Track when a user actively joins a specific chat room with partnerId.
   */
  async handleJoinRoom(io, socket, data) {
    const userId = socket.user.id;
    const { partnerId } = data || {};
    if (!partnerId) return;

    try {
      const [u1, u2] = [userId.toString(), partnerId.toString()].sort();
      const roomKey = `chat:room:${u1}:${u2}`;
      const redisSetKey = `chat:active_room:${u1}:${u2}`;

      socket.join(roomKey);
      socket.data = socket.data || {};
      socket.data.activeChatPartnerId = partnerId.toString();

      if (redisClient.isRedisAvailable) {
        await redisClient.sadd(redisSetKey, userId.toString());
        await redisClient.expire(redisSetKey, 86400);
      }
      logger.info(`[DirectChat] User ${userId} joined room ${roomKey}`);
    } catch (err) {
      logger.error(`[DirectChat handleJoinRoom Error] ${err.message}`);
    }
  }

  /**
   * Track when a user leaves the chat room with partnerId.
   */
  async handleLeaveRoom(io, socket, data) {
    const userId = socket.user.id;
    const partnerId = data?.partnerId || socket.data?.activeChatPartnerId;
    if (!partnerId) return;

    try {
      const [u1, u2] = [userId.toString(), partnerId.toString()].sort();
      const roomKey = `chat:room:${u1}:${u2}`;
      const redisSetKey = `chat:active_room:${u1}:${u2}`;

      socket.leave(roomKey);
      if (socket.data) delete socket.data.activeChatPartnerId;

      if (redisClient.isRedisAvailable) {
        await redisClient.srem(redisSetKey, userId.toString());
      }
      logger.info(`[DirectChat] User ${userId} left room ${roomKey}`);
    } catch (err) {
      logger.error(`[DirectChat handleLeaveRoom Error] ${err.message}`);
    }
  }

  /**
   * Deliver any pending offline messages from Redis Stream on socket connect.
   */
  async deliverOfflineMessages(io, socket) {
    const userId = socket.user.id;

    try {
      const pendingMessages = await readMailboxStream(userId);
      if (!pendingMessages || pendingMessages.length === 0) return;

      logger.info(`[DirectChat] Delivering ${pendingMessages.length} offline message(s) to ${userId}`);

      socket.emit(SERVER_EVENTS.CHAT_OFFLINE_MESSAGES, {
        messages: pendingMessages.map((entry) => ({
          entryId: entry.entryId,
          clientMsgId: entry.clientMsgId,
          senderId: entry.senderId,
          serverTimestamp: entry.serverTs,
          ...entry.payload,
        })),
      });
    } catch (err) {
      logger.error(`[DirectChat] Failed to deliver offline messages to ${userId}: ${err.message}`);
    }
  }

  /**
   * Handle: chat:send_message
   *
   * Flow:
   *  1. Check room presence: Are both in the same active chat room?
   *     - YES: Create / continue active session segment (session-based billing).
   *     - NO: Charge admin-configured coins per message (no session segment).
   *  2. Failure fault-tolerance: Session or billing errors NEVER block or drop message delivery!
   *  3. Immediate socket delivery if receiver online; Redis stream queue if offline.
   *  4. Persist in MongoDB with both senderId and recipientId.
   *  5. ACK sender (✓ single tick).
   */
  async handleSendMessage(io, socket, data) {
    const senderId = socket.user.id;
    const senderType = socket.user.type;
    const { clientMsgId, recipientId, text, messageType = 'TEXT', fileUrl = null } = data || {};

    try {
      if (!clientMsgId || !recipientId || !text) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'clientMsgId, recipientId, and text are required.',
        });
      }

      const serverTimestamp = new Date().toISOString();
      const customerId = senderType === 'CUSTOMER' ? senderId : recipientId;
      const listenerId = senderType === 'CUSTOMER' ? recipientId : senderId;

      // ─── 1. Check if both users are inside the SAME active chat room ───
      const [u1, u2] = [senderId.toString(), recipientId.toString()].sort();
      const redisSetKey = `chat:active_room:${u1}:${u2}`;
      let areBothInActiveChatRoom = false;

      if (redisClient.isRedisAvailable) {
        try {
          const [isReceiverInRoom, isSenderInRoom] = await Promise.all([
            redisClient.sismember(redisSetKey, recipientId.toString()),
            redisClient.sismember(redisSetKey, senderId.toString()),
          ]);
          areBothInActiveChatRoom = !!(isReceiverInRoom && isSenderInRoom);
        } catch {
          areBothInActiveChatRoom = false;
        }
      } else {
        const room = io.sockets.adapter.rooms.get(`chat:room:${u1}:${u2}`);
        areBothInActiveChatRoom = !!(room && room.size >= 2);
      }

      let activeSessionId = null;
      let calculatedMessageCost = 0;

      // ─── 2. Session / Billing Decision ───
      if (areBothInActiveChatRoom) {
        // Case A: Both are inside the same active chat room -> Session-based billing
        try {
          const existingSessionId = await communicationSessionService.getActiveSessionForUser(customerId);
          if (existingSessionId) {
            activeSessionId = existingSessionId;
            if (redisClient.isRedisAvailable) {
              await redisClient.hset(KEYS.activeSession(existingSessionId), {
                lastActivityAt: serverTimestamp,
                isPaused: '0',
              });
            }
          } else {
            const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
            const ratePerMinute = listenerProfile?.chatRate || 0;
            const session = await communicationSessionService.startSession(
              customerId,
              listenerId,
              'CHAT',
              ratePerMinute
            );
            activeSessionId = session._id.toString();

            const startedPayload = {
              sessionId: activeSessionId,
              callerId: customerId,
              listenerId: listenerId,
              ratePerMinute,
              mode: 'CHAT',
            };
            socket.join(`session:${activeSessionId}`);
            io.to(customerId).emit(SERVER_EVENTS.CHAT_STARTED, startedPayload);
            io.to(listenerId).emit(SERVER_EVENTS.CHAT_STARTED, startedPayload);
            io.to(`session:${activeSessionId}`).emit(SERVER_EVENTS.CHAT_STARTED, startedPayload);
          }
        } catch (sessErr) {
          logger.error(`[DirectChat] Session management failed: ${sessErr.message}`);
          // NEVER block message delivery on session failure!
        }
        calculatedMessageCost = 0; // Session covers billing
      } else {
        // Case B: Not in the same active chat room -> Deduct coins per message
        if (senderType === 'CUSTOMER') {
          try {
            const config = await CommunicationConfig.findOne().lean();
            const defaultCoins = config?.defaultCoinsPerMessage ?? 1;
            const listenerProfile = await ListenerProfile.findOne({ userId: recipientId }).lean();
            calculatedMessageCost = listenerProfile?.chatRate > 0 ? listenerProfile.chatRate : defaultCoins;

            const wallet = await Wallet.findOne({ userId: senderId }).lean();
            const currentBalance = wallet?.coinBalance ?? 0;
            if (currentBalance < calculatedMessageCost) {
              socket.emit(SERVER_EVENTS.CHAT_INSUFFICIENT_BALANCE, {
                clientMsgId,
                currentBalance,
                requiredCost: calculatedMessageCost,
                message: `Low coin balance (${currentBalance}).`,
              });
              // Never block delivery even if balance is low!
              calculatedMessageCost = 0;
            }
          } catch (costErr) {
            logger.error(`[DirectChat] Cost calculation error: ${costErr.message}`);
            calculatedMessageCost = 0;
          }
        }
      }

      // ─── 3. Receiver Presence ───
      let receiverPresence = 'OFFLINE';
      if (redisClient.isRedisAvailable) {
        receiverPresence = (await redisClient.get(KEYS.presenceStatus(recipientId))) || 'OFFLINE';
      }
      const isReceiverOnline = receiverPresence === 'ONLINE' || receiverPresence === 'BUSY' || receiverPresence === 'LIVE';

      // ─── 4. Message Payload ───
      const messagePayload = {
        clientMsgId,
        senderId,
        senderType,
        recipientId,
        sessionId: activeSessionId || null,
        text,
        messageType,
        fileUrl,
        serverTimestamp,
      };

      // ─── 5. Hot Path Routing & Stream Queue ───
      let luaResult = { status: 'OK', balance: 0 };
      if (redisClient.isRedisAvailable) {
        luaResult = await deductAndRouteMessage({
          clientMsgId,
          senderId,
          receiverId: recipientId,
          cost: calculatedMessageCost,
          payload: messagePayload,
          isReceiverOnline,
          serverTimestamp,
        });
      }

      // ─── 6. Deliver to Receiver ───
      io.to(recipientId.toString()).emit(SERVER_EVENTS.CHAT_RECEIVE_MESSAGE, messagePayload);
      io.to(`chat:room:${u1}:${u2}`).emit(SERVER_EVENTS.CHAT_RECEIVE_MESSAGE, messagePayload);

      // ─── 7. ACK Sender (✓ single tick) ───
      socket.emit(SERVER_EVENTS.CHAT_ACK_SENT, {
        clientMsgId,
        recipientId,
        partnerId: recipientId,
        serverTimestamp,
        newBalance: luaResult?.balance ?? 0,
        deliveryStatus: isReceiverOnline ? 'DELIVERED' : 'SENT',
      });

      // ─── 8. Immediate Persistence in MongoDB ───
      try {
        const sIdObj = mongoose.Types.ObjectId.isValid(senderId) ? new mongoose.Types.ObjectId(senderId) : senderId;
        const rIdObj = mongoose.Types.ObjectId.isValid(recipientId) ? new mongoose.Types.ObjectId(recipientId) : recipientId;
        const sessIdObj = activeSessionId && mongoose.Types.ObjectId.isValid(activeSessionId) ? new mongoose.Types.ObjectId(activeSessionId) : null;

        await ChatMessage.findOneAndUpdate(
          { clientMsgId },
          {
            $setOnInsert: {
              clientMsgId,
              senderId: sIdObj,
              recipientId: rIdObj,
              sessionId: sessIdObj,
              text,
              messageType,
              fileUrl,
              createdAt: serverTimestamp ? new Date(serverTimestamp) : new Date(),
              deliveryStatus: isReceiverOnline ? 'DELIVERED' : 'SENT',
            },
          },
          { upsert: true, new: true }
        );
      } catch (immErr) {
        logger.error(`[DirectChat] Immediate DB save error: ${immErr.message}`);
      }

      // ─── 9. Enqueue Worker for async reconciliation & wallet deductions ───
      if (luaResult.status !== 'ALREADY_PROCESSED') {
        try {
          await enqueueChatPersistence({
            type: 'SAVE_MESSAGE',
            clientMsgId,
            senderId,
            recipientId,
            sessionId: activeSessionId || null,
            text,
            messageType,
            fileUrl,
            serverTimestamp,
            coinsCost: calculatedMessageCost,
          });
        } catch (qErr) {
          logger.warn(`[DirectChat] Queue enqueue warning: ${qErr.message}`);
        }
      }

      logger.info(`[DirectChat] Message ${clientMsgId} delivered (${senderId} → ${recipientId}, cost=${calculatedMessageCost})`);
    } catch (err) {
      logger.error(`[DirectChat SendMessage Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to send message.', clientMsgId });
    }
  }

  /**
   * Handle: chat:leave
   */
  async handleLeaveChat(io, socket, data) {
    const userId = socket.user.id;
    const userType = socket.user.type;

    try {
      const activeSessionId = await communicationSessionService.getActiveSessionForUser(userId);
      if (!activeSessionId) return;

      const reason = userType === 'CUSTOMER' ? 'CALLER_LEFT' : 'LISTENER_LEFT';
      io.to(`session:${activeSessionId}`).emit(SERVER_EVENTS.CHAT_ENDED, {
        sessionId: activeSessionId,
        reason,
      });

      await communicationSessionService.endSession(activeSessionId, reason);
      logger.info(`[DirectChat] User ${userId} left chat. Session ${activeSessionId} ended.`);
    } catch (err) {
      logger.error(`[DirectChat LeaveChat Error] ${err.message}`);
    }
  }

  /**
   * Handle: chat:ack_delivered
   */
  async handleAckDelivered(io, socket, data) {
    const receiverId = socket.user.id;
    const { entryIds, senderIds } = data || {};

    try {
      if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
        return;
      }

      const deleted = await ackMailboxMessages(receiverId, entryIds);
      logger.info(`[DirectChat] Receiver ${receiverId} ACK'd ${deleted} stream entries.`);

      if (senderIds && Array.isArray(senderIds)) {
        const uniqueSenders = [...new Set(senderIds)];
        for (const senderId of uniqueSenders) {
          io.to(senderId).emit(SERVER_EVENTS.CHAT_MESSAGE_DELIVERED, {
            recipientId: receiverId,
            deliveredAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.error(`[DirectChat AckDelivered Error] ${err.message}`);
    }
  }

  /**
   * Handle: chat:read_conversation
   * Marks conversation as read in MongoDB & Redis, clears unread counter, and notifies sender.
   */
  async handleReadConversation(io, socket, data) {
    const userId = socket.user.id;
    const { partnerId, lastReadMessageId } = data || {};

    try {
      if (!partnerId) return;

      // 1. Mark in MongoDB & Redis
      await chatMessageService.markConversationAsRead(userId, partnerId);

      // 2. Notify the partner (sender) that their messages were read (✓✓ blue ticks)
      io.to(partnerId.toString()).emit(SERVER_EVENTS.CHAT_MESSAGES_READ, {
        readerId: userId.toString(),
        partnerId: partnerId.toString(),
        lastReadMessageId: lastReadMessageId || undefined,
        readAt: new Date().toISOString(),
      });

      logger.info(`[DirectChat] ${userId} read conversation with ${partnerId}`);
    } catch (err) {
      logger.error(`[DirectChat ReadConversation Error] ${err.message}`);
    }
  }

  /**
   * Handle: chat:typing
   */
  handleTyping(io, socket, data) {
    const userId = socket.user.id;
    const { recipientId, isTyping } = data || {};

    if (!recipientId) return;

    io.to(recipientId).emit(SERVER_EVENTS.CHAT_DISPLAY_TYPING, {
      userId,
      isTyping: !!isTyping,
    });
  }
}

export default new DirectChatHandler();
