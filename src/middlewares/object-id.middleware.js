import mongoose from 'mongoose';
import ApiError from '../utils/ApiError.js';

/**
 * Reject non-ObjectId route params (prevents /gifts/admin matching /:id).
 */
export const requireObjectId = (paramName = 'id') => (req, res, next) => {
  const value = req.params[paramName];
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return next(new ApiError(400, `Invalid ${paramName}: must be a valid gift id`));
  }
  next();
};
