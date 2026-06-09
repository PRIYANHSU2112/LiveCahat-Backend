import jwt from 'jsonwebtoken';
import 'dotenv/config';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const JWT_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRATION_MINUTES ? `${process.env.JWT_ACCESS_EXPIRATION_MINUTES}d` : '56d';

/**
 * Generate a JWT access token
 * @param {Object} payload 
 * @returns {String} token
 */
export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verify a JWT token
 * @param {String} token 
 * @returns {Object} decoded payload
 */
export const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
