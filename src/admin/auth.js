const crypto = require('crypto');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AirTranslator2024!';

// Session management
const sessions = new Map();

// In-memory caps and intervals
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LONG_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10m
const MAX_SESSIONS = 5000;

/**
 * Periodic sweeper to control memory
 */
function sweepSessions() {
    const now = Date.now();
    for (const [token, sess] of sessions.entries()) {
        const ttl = sess.isLong ? LONG_SESSION_TTL_MS : SESSION_TTL_MS;
        if (!sess || (now - (sess.createdAt || 0)) > ttl) {
            sessions.delete(token);
        }
    }
    // Cap size: evict oldest entries if over limit
    while (sessions.size > MAX_SESSIONS) {
        const oldestKey = sessions.keys().next().value;
        sessions.delete(oldestKey);
    }
}

// Start periodic session sweeping
setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS).unref();

/**
 * Generates a random session token.
 * @returns {string} The generated session token.
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Verifies admin credentials.
 * @param {string} username - The username to verify.
 * @param {string} password - The password to verify.
 * @returns {boolean} True if the credentials are valid, false otherwise.
 */
function verifyCredentials(username, password) {
    return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

/**
 * Checks if a session is valid.
 * @param {string} sessionToken - The session token to check.
 * @returns {boolean} True if the session is valid, false otherwise.
 */
function isValidSession(sessionToken) {
    const session = sessions.get(sessionToken);
    if (!session) return false;
    
    // Check if the session has expired
    const ttl = session.isLong ? LONG_SESSION_TTL_MS : SESSION_TTL_MS;
    if (Date.now() - session.createdAt > ttl) {
        sessions.delete(sessionToken);
        return false;
    }
    
    return true;
}

/**
 * Creates a new session for a user.
 * @param {string} username - The username.
 * @param {boolean} [isLong=false] - Whether the session should be long-lived.
 * @returns {string} The session token.
 */
function createSession(username, isLong = false) {
    const sessionToken = generateSessionToken();
    sessions.set(sessionToken, {
        createdAt: Date.now(),
        username: username,
        isLong: isLong
    });
    // Cap sessions after insert
    sweepSessions();
    return sessionToken;
}

/**
 * Destroys a session.
 * @param {string} sessionToken - The session token to destroy.
 */
function destroySession(sessionToken) {
    sessions.delete(sessionToken);
}

/**
 * Extracts the session token from the cookie header.
 * @param {string} cookieHeader - The cookie header from the request.
 * @returns {string|null} The session token if found, null otherwise.
 */
function getSessionFromCookies(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('session='));
    return sessionCookie ? sessionCookie.split('=')[1] : null;
}

/**
 * Gets session info
 * @param {string} sessionToken - The session token
 * @returns {Object|null} Session info or null
 */
function getSession(sessionToken) {
    return sessions.get(sessionToken) || null;
}

module.exports = {
    verifyCredentials,
    isValidSession,
    createSession,
    destroySession,
    getSessionFromCookies,
    getSession
};
