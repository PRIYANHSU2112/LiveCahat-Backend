import BaseController from './base.controller.js';
import liveRoomService from '../services/live-room.service.js';
import agoraService from '../services/agora.service.js';
import { stringToUid } from '../utils/agora.util.js';
import catchAsync from '../utils/catchAsync.util.js';
import ApiError from '../utils/ApiError.js';
import config from '../config/index.js';

class LiveRoomController extends BaseController {
  /**
   * GET /live-rooms
   * List all currently live rooms (paginated).
   */
  getLiveRooms = catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const rooms = await liveRoomService.getActiveRooms(Number(page), Number(limit));
    this.sendResponse(res, 200, 'Live rooms fetched', rooms);
  });

  /**
   * GET /live-rooms/:id
   * Get details of a single live room.
   */
  getLiveRoom = catchAsync(async (req, res) => {
    const room = await liveRoomService.getItemById(req.params.id);
    if (!room) throw new ApiError(404, 'Live room not found');
    this.sendResponse(res, 200, 'Live room fetched', room);
  });

  /**
   * POST /live-rooms/:id/agora-token
   * Generate an Agora RTC token for the requesting user.
   * Host → PUBLISHER role. Viewers → SUBSCRIBER role.
   */
  getAgoraToken = catchAsync(async (req, res) => {
    const room = await liveRoomService.getItemById(req.params.id);
    if (!room || room.status !== 'live') throw new ApiError(404, 'Live room not found or has ended');

    const userId = req.user._id.toString();
    const isHost = room.hostId.toString() === userId;
    const uid = stringToUid(userId);
    const role = isHost ? 'PUBLISHER' : 'SUBSCRIBER';
    const token = agoraService.generateRtcToken(room.channelName, uid, role, 3600);

    this.sendResponse(res, 200, 'Agora token generated', {
      token,
      uid,
      channelName: room.channelName,
      appId: config.agora.appId || '',
      role,
    });
  });
}

export default new LiveRoomController();
