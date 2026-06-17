import Joi from 'joi';
import { LIVE_ROOM_MODES } from '../constants/enum.constant.js';

export const getLiveRoomsSchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
});

export const getLiveRoomSchema = Joi.object({
  params: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
});

export const getAgoraTokenSchema = Joi.object({
  params: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
});
