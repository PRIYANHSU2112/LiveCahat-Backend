import logger from '../utils/logger.util.js';
import ApiError from '../utils/ApiError.js';

const handleCastErrorDB = err => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new ApiError(400, message);
};

const handleDuplicateFieldsDB = err => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new ApiError(400, message);
};

const handleValidationErrorDB = err => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new ApiError(400, message);
};

const handleJWTError = () => new ApiError(401, 'Invalid token. Please log in again!');
const handleJWTExpiredError = () => new ApiError(401, 'Your token has expired! Please log in again.');

const sendErrorDev = (err, req, res) => {
  logger.error(`[ERROR] ${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  return res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack
  });
};

const sendErrorProd = (err, req, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message
    });
  }
  // Programming or other unknown error: log details and return clean 500
  logger.error(`[CRITICAL ERROR] ${req.method} ${req.originalUrl}:`, err);
  const message =
    err.message ||
    err.error?.description ||
    err.description ||
    (typeof err.error === 'string' ? err.error : null) ||
    'Something went very wrong!';
  return res.status(500).json({
    success: false,
    message
  });
};

export const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err };
    error.message = err.message;
    error.name = err.name;

    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    
    // Joi validation errors
    if (error.isJoi) {
      error = new ApiError(400, error.details[0].message);
    }

    sendErrorProd(error, req, res);
  }
};
