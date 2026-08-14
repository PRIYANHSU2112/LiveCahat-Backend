import jwt from 'jsonwebtoken';
import 'dotenv/config';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;

// Access token expiration: 15 minutes (or JWT_ACCESS_EXPIRATION_MINUTES)
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRATION_MINUTES
  ? `${process.env.JWT_ACCESS_EXPIRATION_MINUTES}m`
  : '15m';

// Refresh token expiration: 30 days (or JWT_REFRESH_EXPIRATION_DAYS)
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRATION_DAYS
  ? `${process.env.JWT_REFRESH_EXPIRATION_DAYS}d`
  : '30d';

/**
 * Generate a JWT access token
 * @param {Object} payload 
 * @returns {String} token
 */
export const generateToken = (payload) => {
  return jwt.sign({ ...payload, tokenType: 'access' }, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRES_IN });
};

/**
 * Generate a JWT refresh token
 * @param {Object} payload 
 * @returns {String} refreshToken
 */
export const generateRefreshToken = (payload) => {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
};

/**
 * Generate both Access and Refresh tokens
 * @param {Object} payload 
 * @returns {Object} { token, refreshToken }
 */
export const generateAuthTokens = (payload) => {
  const token = generateToken(payload);
  const refreshToken = generateRefreshToken(payload);
  return { token, refreshToken };
};

/**
 * Verify a JWT access token
 * @param {String} token 
 * @returns {Object} decoded payload
 */
export const verifyToken = (token) => {
  const decoded = jwt.verify(token, JWT_SECRET);
  return decoded;
};

/**
 * Verify a JWT refresh token
 * @param {String} token 
 * @returns {Object} decoded payload
 */
export const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
  if (decoded.tokenType !== 'refresh') {
    throw new Error('Invalid token type for refresh');
  }
  return decoded;
};
