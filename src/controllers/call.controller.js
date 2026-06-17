import BaseController from './base.controller.js';
import callService from '../services/call.service.js';
import catchAsync from '../utils/catchAsync.util.js';

/**
 * CallController – REST endpoints for audio/video call management.
 *
 * Provides HTTP-based call initiation, Agora token retrieval, and
 * call termination. Socket-based signaling is handled separately
 * by the call.handler.js socket handler.
 */
class CallController extends BaseController {

  /**
   * POST /calls/initiate
   * Initiate a new audio or video call session.
   *
   * Body: { listenerId: String, mode: 'AUDIO' | 'VIDEO' }
   */
  initiateCall = catchAsync(async (req, res) => {
    const callerId = req.user._id.toString();
    const { listenerId, mode } = req.body;

    const result = await callService.initiateCall(callerId, listenerId, mode);

    this.sendResponse(res, 201, 'Call session initiated successfully', {
      sessionId: result.session._id,
      agoraToken: result.agoraToken,
      channelName: result.channelName,
      agoraUid: result.agoraUid,
      agoraAppId: result.agoraAppId,
    });
  });

  /**
   * GET /calls/token/:sessionId
   * Retrieve (or refresh) an Agora RTC token for an active session.
   *
   * The requesting user must be a verified participant (caller or listener).
   */
  getToken = catchAsync(async (req, res) => {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;

    const result = await callService.getTokenForSession(userId, sessionId);

    this.sendResponse(res, 200, 'Agora token generated successfully', result);
  });

  /**
   * POST /calls/end
   * End an active call session via REST.
   *
   * Body: { sessionId: String }
   */
  endCall = catchAsync(async (req, res) => {
    const userId = req.user._id.toString();
    const { sessionId } = req.body;

    await callService.endCall(userId, sessionId);

    this.sendResponse(res, 200, 'Call ended successfully');
  });
}

export default new CallController();
