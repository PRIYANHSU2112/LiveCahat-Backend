/**
 * Agora Utility – Deterministic UID Generation
 *
 * Agora RTC requires integer UIDs. This module deterministically maps
 * MongoDB ObjectId strings to positive unsigned 32-bit integers using
 * the FNV-1a non-cryptographic hash — fast and collision-resistant.
 */

/**
 * Convert a string identifier to a positive 32-bit unsigned integer.
 * Uses FNV-1a hashing.
 *
 * @param {string} str - The string to convert (typically a MongoDB ObjectId hex string).
 * @returns {number} Unsigned 32-bit integer (never 0 — Agora treats 0 as wildcard).
 */
export const stringToUid = (str) => {
  if (!str) return 1;

  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV-1a multiply – 0x01000193 expanded to bit shifts for speed
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  const uid = hash >>> 0; // Force unsigned 32-bit
  return uid === 0 ? 1 : uid;
};

/**
 * Build the Agora channel name from a session ID.
 * Prefixed for namespacing so channel names are never raw IDs.
 *
 * @param {string} sessionId - MongoDB CommunicationSession ObjectId.
 * @returns {string} Channel name (e.g. `session_664a3b...`).
 */
export const buildChannelName = (sessionId) => {
  return `session_${sessionId}`;
};

/**
 * Build the Agora channel name for a live room.
 *
 * @param {string} roomId - MongoDB LiveRoom ObjectId.
 * @returns {string} Channel name (e.g. `live_664a3b...`).
 */
export const buildLiveChannelName = (roomId) => {
  return `live_${roomId}`;
};
