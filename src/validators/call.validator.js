import Joi from 'joi';

/**
 * Call Validators – Joi schemas for call-related route inputs.
 */

const objectId = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .message('{{#label}} must be a valid 24-character ObjectId');

const callValidator = {
  /**
   * POST /calls/initiate
   */
  initiateCall: {
    body: Joi.object({
      listenerId: objectId.required(),
      mode: Joi.string().valid('AUDIO', 'VIDEO').required(),
    }),
  },

  /**
   * GET /calls/token/:sessionId
   */
  getToken: {
    params: Joi.object({
      sessionId: objectId.required(),
    }),
  },

  /**
   * POST /calls/end
   */
  endCall: {
    body: Joi.object({
      sessionId: objectId.required(),
    }),
  },
};

export default callValidator;
