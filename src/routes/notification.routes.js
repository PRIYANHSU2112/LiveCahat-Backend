import express from 'express';
import notificationController from '../controllers/notification.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  listNotificationQuerySchema,
  idParamSchema,
  sendNotificationSchema,
  broadcastNotificationSchema,
} from '../validators/notification.validator.js';

const router = express.Router();

router.use(authenticate);

// ─── Authenticated users (customer / listener / agent / admin) ──────
// Everyone only ever sees and manages their OWN notifications.
router.get('/', validate(listNotificationQuerySchema), notificationController.getMyNotifications);
router.get('/stats', notificationController.getMyStats);
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', validate(idParamSchema), notificationController.markAsRead);
router.delete('/:id', validate(idParamSchema), notificationController.deleteNotification);

// ─── Admin only ─────────────────────────────────────────────────────
router.use(restrictTo('ADMIN'));
// Send to a specific user / listener / agent
router.post('/admin/send', validate(sendNotificationSchema), notificationController.sendToUser);
// Broadcast to all users / all listeners / all agents / everyone
router.post('/admin/broadcast', validate(broadcastNotificationSchema), notificationController.broadcast);
router.get('/admin/stats', notificationController.getAdminStats);

export default router;
