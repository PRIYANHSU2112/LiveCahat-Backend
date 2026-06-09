import ApiResponse from '../utils/ApiResponse.js';

/**
 * Base Controller providing standardized HTTP response methods.
 */
export default class BaseController {

  /**
   * Send a standard formatted JSON response.
   */
  sendResponse(res, statusCode, message, data = null) {
    const response = new ApiResponse(statusCode, data, message);
    return res.status(statusCode).json(response);
  }

  /**
   * Send a standard error response. (Can also be handled by global error handler)
   */

  sendError(res, statusCode, message, errors = []) {
    return res.status(statusCode).json({
      success: false,
      message,
      errors
    });
  }
}
