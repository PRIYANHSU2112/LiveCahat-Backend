import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import liveRoomService from '../services/live-room.service.js';
import agoraService from '../services/agora.service.js';
import presenceService from '../services/presence.service.js';
import { stringToUid } from '../utils/agora.util.js';
import { joinLiveRoom, leaveLiveRoom, emitToLiveRoom } from '../utils/socket-room.util.js';
import config from '../config/index.js';
import logger from '../utils/logger.util.js';

/**
 * LiveHandler – Socket.io signaling for Group Live Rooms (Instagram-style).
 *
 * Flow:
 *  1. Host (LISTENER) emits `live:start` → room created, host gets PUBLISHER token.
 *  2. Viewers emit `live:join` → subscriber token + recent comments returned.
 *  3. Anyone in the room can emit `live:comment` or `live:like`.
 *  4. Host emits `live:end` (or disconnects) → room torn down, `live:ended` broadcast.
 *  5. Abrupt host disconnect → 30-second grace period before auto-end.
 */
class LiveHandler {
  register(io, socket) {
    socket.on(CLIENT_EVENTS.LIVE_START, (data) => this.startLive(io, socket, data));
    socket.on(CLIENT_EVENTS.LIVE_END, (data) => this.endLive(io, socket, data));
    socket.on(CLIENT_EVENTS.LIVE_JOIN, (data) => this.joinLive(io, socket, data));
    socket.on(CLIENT_EVENTS.LIVE_LEAVE, (data) => this.leaveLive(io, socket, data));
    socket.on(CLIENT_EVENTS.LIVE_COMMENT, (data) => this.sendComment(io, socket, data));
    socket.on(CLIENT_EVENTS.LIVE_LIKE, (data) => this.sendLike(io, socket, data));
    socket.on('disconnect', () => this.handleDisconnect(io, socket));
  }

  // ─── START ────────────────────────────────────────────────────────────────

  /**
   * Host starts a live room.
   * @param {Object} data - { title?: string, mode: 'AUDIO' | 'VIDEO' }
   */
  async startLive(_io, socket, data) {
    const hostId = socket.user.id;

    try {
      if (socket.user.type !== 'LISTENER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only listeners can start a live room.' });
      }

      const { title = '', mode } = data || {};
      if (!mode || !['AUDIO', 'VIDEO'].includes(mode)) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Mode must be AUDIO or VIDEO.' });
      }

      // If host reconnected mid-grace, cancel the pending auto-end
      await liveRoomService.clearDisconnectGrace(hostId);

      const room = await liveRoomService.createRoom(hostId, { title, mode });
      const roomId = room._id.toString();

      const uid = stringToUid(hostId);
      const token = agoraService.generateRtcToken(room.channelName, uid, 'PUBLISHER', 3600);

      joinLiveRoom(socket, roomId);

      // Mark host LIVE so home/discover cards show LIVE badge
      await presenceService.setLive(hostId);

      socket.emit(SERVER_EVENTS.LIVE_STARTED, {
        roomId,
        channelName: room.channelName,
        title: room.title,
        mode: room.mode,
        agora: {
          appId: config.agora.appId || '',
          token,
          channelName: room.channelName,
          uid,
        },
      });

      logger.info(`[Live Start] Host ${hostId} started live room ${roomId} (${mode})`);
    } catch (err) {
      logger.error(`[Live Start Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to start live room.' });
    }
  }

  // ─── END ──────────────────────────────────────────────────────────────────

  /**
   * Host explicitly ends the live room.
   * @param {Object} data - { roomId: string }
   */
  async endLive(io, socket, data) {
    const hostId = socket.user.id;

    try {
      const { roomId } = data || {};
      if (!roomId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Room ID is required.' });
      }

      const room = await liveRoomService.getItemById(roomId);
      if (!room || room.status !== 'live') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Live room not found or already ended.' });
      }
      if (room.hostId.toString() !== hostId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only the host can end this room.' });
      }

      await this._tearDownRoom(io, roomId, hostId);
    } catch (err) {
      logger.error(`[Live End Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to end live room.' });
    }
  }

  // ─── JOIN ─────────────────────────────────────────────────────────────────

  /**
   * Viewer joins an active live room.
   * @param {Object} data - { roomId: string }
   */
  async joinLive(io, socket, data) {
    const userId = socket.user.id;

    try {
      const { roomId } = data || {};
      if (!roomId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Room ID is required.' });
      }

      const room = await liveRoomService.getLiveRoomWithHost(roomId);
      if (!room || room.status !== 'live') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Live room not found or has ended.' });
      }

      const hostDoc =
        room.hostId && typeof room.hostId === 'object' ? room.hostId : null;
      const hostIdStr = hostDoc?._id?.toString?.() || room.hostId?.toString?.() || room.hostId;

      const uid = stringToUid(userId);

      // Generate Agora token + add viewer + fetch recent comments + get like count + check if user liked in parallel
      const [token, [viewerCount, recentComments, likeCount, hasLiked]] = await Promise.all([
        Promise.resolve(agoraService.generateRtcToken(room.channelName, uid, 'SUBSCRIBER', 3600)),
        Promise.all([
          liveRoomService.addViewer(roomId, userId),
          liveRoomService.getRecentComments(roomId),
          liveRoomService.getLikeCount(roomId),
          liveRoomService.hasUserLiked(roomId, userId),
        ]),
      ]);

      joinLiveRoom(socket, roomId);

      const hostName = hostDoc
        ? `${hostDoc.firstName || ''} ${hostDoc.lastName || ''}`.trim()
        : '';

      // Confirm join to the viewer
      socket.emit(SERVER_EVENTS.LIVE_VIEWER_JOINED, {
        roomId,
        channelName: room.channelName,
        title: room.title,
        mode: room.mode || 'VIDEO',
        hostId: hostIdStr,
        hostName: hostName || undefined,
        hostImage: hostDoc?.profileImage || undefined,
        viewerCount,
        likeCount,
        hasLiked,
        recentComments,
        agora: {
          appId: config.agora.appId || '',
          token,
          channelName: room.channelName,
          uid,
        },
      });

      // Broadcast updated viewer count to the whole room (Host + Viewers)
      emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_VIEWER_COUNT_UPDATE, {
        roomId,
        viewerCount,
        userId,
      });

      logger.info(`[Live Join] User ${userId} joined room ${roomId}. Viewers: ${viewerCount}`);
    } catch (err) {
      logger.error(`[Live Join Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to join live room.' });
    }
  }

  // ─── LEAVE ────────────────────────────────────────────────────────────────

  /**
   * Viewer voluntarily leaves the live room.
   * @param {Object} data - { roomId: string }
   */
  async leaveLive(io, socket, data) {
    const userId = socket.user.id;

    try {
      const { roomId } = data || {};
      if (!roomId) return;

      const viewerCount = await liveRoomService.removeViewer(roomId, userId);
      leaveLiveRoom(socket, roomId);

      emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_VIEWER_LEFT, {
        roomId,
        viewerCount,
        userId,
      });

      emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_VIEWER_COUNT_UPDATE, {
        roomId,
        viewerCount,
      });

      logger.info(`[Live Leave] User ${userId} left room ${roomId}. Viewers: ${viewerCount}`);
    } catch (err) {
      logger.error(`[Live Leave Error] ${err.message}`);
    }
  }

  // ─── COMMENT ─────────────────────────────────────────────────────────────

  /**
   * Any participant (Viewer or Host) posts a comment.
   * @param {Object} data - { roomId: string, text: string }
   */
  async sendComment(io, socket, data) {
    const userId = socket.user.id;
    const userName =
      `${socket.user.firstName || ''} ${socket.user.lastName || ''}`.trim() ||
      socket.user.email?.split('@')[0] ||
      'User';

    try {
      const { roomId, text } = data || {};
      if (!roomId || !text || !text.trim()) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Room ID and comment text are required.' });
      }
      if (text.length > 200) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Comment must be 200 characters or fewer.' });
      }

      // Check if commenter is host
      const isHost = socket.user.type === 'LISTENER';

      // Ensure socket is joined to live room
      joinLiveRoom(socket, roomId);

      const comment = await liveRoomService.addComment(
        roomId,
        userId,
        userName,
        text.trim(),
        socket.user.profileImage || null,
        isHost
      );

      emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_NEW_COMMENT, comment);
    } catch (err) {
      logger.error(`[Live Comment Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to send comment.' });
    }
  }

  // ─── LIKE ─────────────────────────────────────────────────────────────────

  /**
   * Any participant toggles a like (1 like per user: like / unlike).
   * @param {Object} data - { roomId: string }
   */
  async sendLike(io, socket, data) {
    try {
      const { roomId } = data || {};
      if (!roomId) return;

      // Ensure socket is in room
      joinLiveRoom(socket, roomId);

      const result = await liveRoomService.toggleLike(roomId, socket.user.id);

      emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_LIKE_UPDATE, {
        roomId,
        likeCount: result.likeCount,
        userId: socket.user.id,
        liked: result.liked,
      });
    } catch (err) {
      logger.error(`[Live Like Error] ${err.message}`);
    }
  }

  // ─── DISCONNECT ───────────────────────────────────────────────────────────

  async handleDisconnect(io, socket) {
    const userId = socket.user.id;
    const userType = socket.user.type;

    try {
      // 1. Clean up viewer tracking for any disconnected user (CUSTOMER, LISTENER, AGENT)
      const viewerRoomId = await liveRoomService.getViewerRoom(userId);
      if (viewerRoomId) {
        const viewerCount = await liveRoomService.removeViewer(viewerRoomId, userId);
        emitToLiveRoom(io, viewerRoomId, SERVER_EVENTS.LIVE_VIEWER_LEFT, {
          roomId: viewerRoomId,
          viewerCount,
          userId,
        });
        emitToLiveRoom(io, viewerRoomId, SERVER_EVENTS.LIVE_VIEWER_COUNT_UPDATE, {
          roomId: viewerRoomId,
          viewerCount,
        });
      }

      // 2. Host disconnect: start 30-second grace period
      if (userType === 'LISTENER') {
        const room = await liveRoomService.getActiveRoomByHost(userId);
        if (!room) return;

        const roomId = room._id.toString();
        logger.info(`[Live Disconnect] Host ${userId} disconnected from room ${roomId}. Grace period started.`);

        await liveRoomService.setDisconnectGrace(userId, roomId, async (expiredRoomId) => {
          logger.info(`[Live Auto-End] Grace expired for host ${userId}. Auto-ending room ${expiredRoomId}.`);
          await this._tearDownRoom(io, expiredRoomId, userId);
        });
      }
    } catch (err) {
      logger.error(`[Live Disconnect Error] ${err.message}`);
    }
  }

  // ─── INTERNAL ─────────────────────────────────────────────────────────────

  async _tearDownRoom(io, roomId, hostId) {
    await liveRoomService.endRoom(roomId, hostId);
    emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_ENDED, { roomId });

    // Restore ONLINE if socket still connected; otherwise leave OFFLINE as-is
    const status = await presenceService.getStatus(hostId);
    if (status === 'LIVE' || status === 'ONLINE' || status === 'BUSY') {
      await presenceService.setAvailable(hostId);
    }

    logger.info(`[Live End] Room ${roomId} ended by host ${hostId}`);
  }
}

export default new LiveHandler();
