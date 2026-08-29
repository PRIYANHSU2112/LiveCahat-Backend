import BaseController from './base.controller.js';
import notificationService from '../services/notification.service.js';
import fcmService from '../services/fcm.service.js';
import User from '../modules/user.model.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.util.js';

class NotificationController extends BaseController {
  // ─── Recipient-facing (own notifications only) ───────────────────

  // GET /notifications — list my notifications (filters: status, type, page, limit)
  getMyNotifications = catchAsync(async (req, res) => {
    const data = await notificationService.getMyNotifications(req.user._id, req.query);
    this.sendResponse(res, 200, 'Notifications fetched successfully', data);
  });

  // GET /notifications/unread-count
  getUnreadCount = catchAsync(async (req, res) => {
    const data = await notificationService.getUnreadCount(req.user._id);
    this.sendResponse(res, 200, 'Unread count fetched successfully', data);
  });

  // GET /notifications/stats — personal inbox KPIs (agent / admin / all roles)
  getMyStats = catchAsync(async (req, res) => {
    const data = await notificationService.getMyStats(req.user._id);
    this.sendResponse(res, 200, 'Notification stats fetched successfully', data);
  });

  // PATCH /notifications/:id/read
  markAsRead = catchAsync(async (req, res) => {
    const data = await notificationService.markAsRead(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Notification marked as read', data);
  });

  // PATCH /notifications/read-all
  markAllAsRead = catchAsync(async (req, res) => {
    const data = await notificationService.markAllAsRead(req.user._id);
    this.sendResponse(res, 200, 'All notifications marked as read', data);
  });

  // DELETE /notifications/:id
  deleteNotification = catchAsync(async (req, res) => {
    const data = await notificationService.deleteNotification(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Notification deleted successfully', data);
  });

  // PATCH /notifications/fcm-token
  updateFcmToken = catchAsync(async (req, res) => {
    const { fcmToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    this.sendResponse(res, 200, 'FCM token updated successfully', { fcmToken });
  });

  // ─── Admin ───────────────────────────────────────────────────────

  // POST /notifications/admin/send — send to one user/listener/agent
  sendToUser = catchAsync(async (req, res) => {
    const data = await notificationService.sendToUser(req.user._id, req.body);
    this.sendResponse(res, 201, 'Notification sent successfully', data);
  });

  // POST /notifications/admin/broadcast — send to all users / listeners / agents
  broadcast = catchAsync(async (req, res) => {
    const data = await notificationService.broadcast(req.user._id, req.body);
    this.sendResponse(res, 201, 'Broadcast notification sent successfully', data);
  });

  // GET /notifications/admin/stats — platform-wide KPIs
  getAdminStats = catchAsync(async (req, res) => {
    const data = await notificationService.getAdminStats();
    this.sendResponse(res, 200, 'Admin notification stats fetched successfully', data);
  });

  // GET /notifications/admin — paginated platform log
  adminListNotifications = catchAsync(async (req, res) => {
    const data = await notificationService.adminListNotifications(req.query);
    this.sendResponse(res, 200, 'Notifications fetched successfully', data);
  });

  // POST /notifications/admin/test-push
  testPush = catchAsync(async (req, res) => {
    let token = req.body.token;
    if (!token && req.body.userId) {
      const user = await User.findById(req.body.userId).select('fcmToken').lean();
      if (!user?.fcmToken) {
        throw new ApiError(404, 'User does not have an FCM token registered');
      }
      token = user.fcmToken;
    }

    const result = await fcmService.sendToToken(token, {
      title: req.body.title || 'Test Notification',
      body: req.body.body || 'This is a test notification from Firebase Admin SDK',
      data: req.body.data || {},
    });

    this.sendResponse(
      res,
      result.success ? 200 : 400,
      result.success ? 'Test push sent successfully' : 'Failed to send test push',
      result
    );
  });
}

export default new NotificationController();
