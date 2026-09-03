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
import Wallet from '../modules/wallet.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import redisClient from '../config/redis.js';
import logger from '../utils/logger.util.js';

/**
 * WhatsApp-Style Direct Chat Handler.
 *
 * Handles conversation-based messaging that works independently of active call/session.
 * Messages route through Redis (hot path) and persist asynchronously via BullMQ.
 */
class DirectChatHandler {
  /**
   * Register direct chat socket events on a connected socket.
   */
  register(io, socket) {
    socket.on(CLIENT_EVENTS.CHAT_SEND_MESSAGE, (data) => this.handleSendMessage(io, socket, data));
    socket.on(CLIENT_EVENTS.CHAT_ACK_DELIVERED, (data) => this.handleAckDelivered(io, socket, data));
    socket.on(CLIENT_EVENTS.CHAT_READ_CONVERSATION, (data) => this.handleReadConversation(io, socket, data));
    socket.on(CLIENT_EVENTS.CHAT_TYPING, (data) => this.handleTyping(io, socket, data));
    socket.on('chat:leave', (data) => this.handleLeaveChat(io, socket, data));
  }

  /**
   * Deliver any pending offline messages from Redis Stream on socket connect.
   * Called from connection.handler.js during handleConnection.
   * Messages are NOT deleted until receiver sends ack_delivered.
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
   * Client sends: { clientMsgId, recipientId, text, messageType?, fileUrl?, cost? }
   *
   * Flow:
   *  1. Atomic Lua: idempotency check → balance check → debit → stream route → unread inc
   *  2. If receiver online → emit chat:receive_message directly
   *  3. Enqueue BullMQ job for MongoDB persistence
   *  4. ACK sender with chat:ack_sent (✓ single tick)
   */
  async handleSendMessage(io, socket, data) {
    const senderId = socket.user.id;
    const senderType = socket.user.type;
    const { clientMsgId, recipientId, text, messageType = 'TEXT', fileUrl = null, cost = 0 } = data || {};

    try {
      // Validate required fields
      if (!clientMsgId || !recipientId || !text) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'clientMsgId, recipientId, and text are required.',
        });
      }

      // ─── 1. Strict Balance Verification for Customer ───
      let listenerChatRate = 0;
      if (senderType === 'CUSTOMER') {
        const wallet = await Wallet.findOne({ userId: senderId }).lean();
        const customerBalance = wallet ? wallet.coinBalance : 0;
        if (redisClient.isRedisAvailable) {
          await redisClient.set(KEYS.walletBalance(senderId), customerBalance.toString());
        }

        // Check listener profile to determine if listener charges coins
        const listenerProfile = await ListenerProfile.findOne({ userId: recipientId }).lean();
        listenerChatRate = listenerProfile?.chatRate || 0;
        const explicitCost = parseInt(cost, 10) || 0;
        const requiredBalance = Math.max(explicitCost, listenerChatRate > 0 ? listenerChatRate : 0);

        // Customer must have balance > 0 and >= requiredBalance
        if (customerBalance <= 0 || (requiredBalance > 0 && customerBalance < requiredBalance)) {
          return socket.emit(SERVER_EVENTS.CHAT_INSUFFICIENT_BALANCE, {
            clientMsgId,
            currentBalance: customerBalance,
            requiredCost: requiredBalance,
            message: `Insufficient coins (${customerBalance}). You need at least ${requiredBalance} coins to chat with this listener.`,
          });
        }
      }

      // ─── 2. Receiver Presence & Session Segment Management ───
      let receiverPresence = 'OFFLINE';
      if (redisClient.isRedisAvailable) {
        receiverPresence = (await redisClient.get(KEYS.presenceStatus(recipientId))) || 'OFFLINE';
      }
      const isReceiverOnline = receiverPresence === 'ONLINE' || receiverPresence === 'BUSY' || receiverPresence === 'LIVE';
      const isReceiverActivelyAvailable = receiverPresence === 'ONLINE';

      const customerId = senderType === 'CUSTOMER' ? senderId : recipientId;
      const listenerId = senderType === 'CUSTOMER' ? recipientId : senderId;
      const serverTimestamp = new Date().toISOString();

      // Session segments start/continue ONLY when both are actively in chat
      if (isReceiverActivelyAvailable) {
        try {
          const existingSessionId = await communicationSessionService.getActiveSessionForUser(customerId);
          if (existingSessionId) {
            let sessionData = null;
            if (redisClient.isRedisAvailable) {
              sessionData = await redisClient.hgetall(KEYS.activeSession(existingSessionId));
            }
            if (sessionData && sessionData.listenerId === listenerId) {
              await redisClient.hset(KEYS.activeSession(existingSessionId), {
                lastActivityAt: serverTimestamp,
                isPaused: '0',
              });
            }
          } else {
            // Both are actively in chat and no active session exists — auto-start session segment
            const ratePerMinute = listenerChatRate || 0;
            const session = await communicationSessionService.startSession(
              customerId,
              listenerId,
              'CHAT',
              ratePerMinute
            );
            const newSessionId = session._id.toString();
            if (redisClient.isRedisAvailable) {
              await redisClient.hset(KEYS.activeSession(newSessionId), {
                lastActivityAt: serverTimestamp,
                isPaused: '0',
              });
            }
            const startedPayload = {
              sessionId: newSessionId,
              callerId: customerId,
              listenerId: listenerId,
              ratePerMinute,
              mode: 'CHAT',
            };
            socket.join(`session:${newSessionId}`);
            io.to(customerId).emit(SERVER_EVENTS.CHAT_STARTED, startedPayload);
            io.to(listenerId).emit(SERVER_EVENTS.CHAT_STARTED, startedPayload);
            io.to(`session:${newSessionId}`).emit(SERVER_EVENTS.CHAT_STARTED, startedPayload);
            logger.info(`[DirectChat] Active session ${newSessionId} auto-started between ${customerId} and ${listenerId}`);
          }
        } catch (sessErr) {
          logger.error(`[DirectChat] Error auto-managing session segment: ${sessErr.message}`);
        }
      }

      // Build the message payload
      const messagePayload = {
        clientMsgId,
        senderId,
        senderType,
        recipientId,
        text,
        messageType,
        fileUrl,
        serverTimestamp,
      };

      // Atomic Lua: idempotency + balance + debit + stream + unread
      const luaResult = await deductAndRouteMessage({
        clientMsgId,
        senderId,
        receiverId: recipientId,
        cost: parseInt(cost, 10) || 0,
        payload: messagePayload,
        isReceiverOnline,
        serverTimestamp,
      });

      // Handle Lua result statuses
      if (luaResult.status === 'INSUFFICIENT_BALANCE') {
        return socket.emit(SERVER_EVENTS.CHAT_INSUFFICIENT_BALANCE, {
          clientMsgId,
          currentBalance: luaResult.balance,
          requiredCost: cost,
          message: 'Insufficient coins. Please recharge to send messages.',
        });
      }

      if (luaResult.status === 'REDIS_UNAVAILABLE' || luaResult.status === 'ERROR') {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'Messaging service temporarily unavailable. Please retry.',
          clientMsgId,
        });
      }

      // If receiver is online, deliver message directly via socket
      if (isReceiverOnline) {
        io.to(recipientId).emit(SERVER_EVENTS.CHAT_RECEIVE_MESSAGE, messagePayload);
      }

      // ACK sender: message accepted (✓ single tick)
      socket.emit(SERVER_EVENTS.CHAT_ACK_SENT, {
        clientMsgId,
        serverTimestamp,
        newBalance: luaResult.balance,
        deliveryStatus: isReceiverOnline ? 'DELIVERED' : 'SENT',
      });

      // If already processed (retry), still ACK the sender but skip persistence
      if (luaResult.status === 'ALREADY_PROCESSED') {
        logger.info(`[DirectChat] Duplicate clientMsgId ${clientMsgId} — ACK sent, no re-persist.`);
        return;
      }

      // Enqueue BullMQ job for async MongoDB persistence
      await enqueueChatPersistence({
        type: 'SAVE_MESSAGE',
        clientMsgId,
        senderId,
        recipientId,
        text,
        messageType,
        fileUrl,
        serverTimestamp,
        coinsCost: parseInt(cost, 10) || 0,
      });

      logger.info(`[DirectChat] Message ${clientMsgId} from ${senderId} → ${recipientId} (online=${isReceiverOnline})`);
    } catch (err) {
      logger.error(`[DirectChat SendMessage Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to send message.', clientMsgId });
    }
  }

  /**
   * Handle: chat:leave
   * Client leaves the chat view — settles and cleans up the active session segment.
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
      logger.info(`[DirectChat] User ${userId} left chat. Session ${activeSessionId} settled and ended.`);
    } catch (err) {
      logger.error(`[DirectChat LeaveChat Error] ${err.message}`);
    }
  }

  /**
   * Handle: chat:ack_delivered
   * Receiver confirms delivery of offline messages.
   * ONLY after this ACK do we delete entries from the Redis Stream.
   *
   * Client sends: { entryIds: ['1688000000000-0', ...] }
   */
  async handleAckDelivered(io, socket, data) {
    const receiverId = socket.user.id;
    const { entryIds, senderIds } = data || {};

    try {
      if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
        return; // Silently ignore malformed ACKs
      }

      // Delete ACK'd entries from the stream
      const deleted = await ackMailboxMessages(receiverId, entryIds);
      logger.info(`[DirectChat] Receiver ${receiverId} ACK'd ${deleted} stream entries.`);

      // Notify each unique sender that their messages were delivered (✓✓ double tick)
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
   * User marks a conversation as read up to a specific messageId.
   * Uses monotonic lastReadMessageId (forward-only).
   *
   * Client sends: { partnerId, lastReadMessageId }
   */
  async handleReadConversation(io, socket, data) {
    const userId = socket.user.id;
    const { partnerId, lastReadMessageId } = data || {};

    try {
      if (!partnerId || !lastReadMessageId) return;

      const result = await updateReadPointer(userId, partnerId, lastReadMessageId);

      if (result.updated) {
        // Notify the partner (sender) that their messages were read (✓✓ blue ticks)
        io.to(partnerId).emit(SERVER_EVENTS.CHAT_MESSAGES_READ, {
          readerId: userId,
          lastReadMessageId,
          readAt: new Date().toISOString(),
        });

        // Enqueue async DB update for read status
        await enqueueChatPersistence({
          type: 'MARK_READ',
          readerId: userId,
          partnerId,
          lastReadMessageId,
        });

        logger.info(`[DirectChat] ${userId} read conversation with ${partnerId} up to ${lastReadMessageId}`);
      }
    } catch (err) {
      logger.error(`[DirectChat ReadConversation Error] ${err.message}`);
    }
  }

  /**
   * Handle: chat:typing
   * Forwards typing indicators directly to the partner.
   *
   * Client sends: { recipientId, isTyping }
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
