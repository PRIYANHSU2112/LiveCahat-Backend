import express from 'express';
import liveRoomController from '../controllers/live-room.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  getLiveRoomsSchema,
  getLiveRoomSchema,
  getAgoraTokenSchema,
} from '../validators/live-room.validator.js';

const router = express.Router();

router.use(authenticate);

/** GET /api/v1/live-rooms — list active live rooms */
router.get('/', validate(getLiveRoomsSchema), liveRoomController.getLiveRooms);

/** GET /api/v1/live-rooms/:id — get a single room */
router.get('/:id', validate(getLiveRoomSchema), liveRoomController.getLiveRoom);

/** POST /api/v1/live-rooms/:id/agora-token — generate Agora RTC token */
router.post('/:id/agora-token', validate(getAgoraTokenSchema), liveRoomController.getAgoraToken);

export default router;
