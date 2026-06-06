/**
 * Common HTTP status codes and standard responses.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

export const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Validation Failed',
  UNAUTHORIZED_ACCESS: 'Unauthorized Access',
  RESOURCE_NOT_FOUND: 'Resource Not Found',
};
