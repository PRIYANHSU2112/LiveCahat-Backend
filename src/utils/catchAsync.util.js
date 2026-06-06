/**
 * Utility wrapper to catch asynchronous errors in Express routes/controllers,
 * eliminating the need for try-catch blocks everywhere.
 */
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => next(err));
};

export default catchAsync;
