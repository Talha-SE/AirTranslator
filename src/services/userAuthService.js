const axios = require('axios');
const crypto = require('crypto');

// Discord OAuth2 configuration
const DISCORD_CLIENT_ID = process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173/auth/callback';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// User sessions storage
const userSessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generate a random session token
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Get Discord OAuth2 authorization URL
 */
function getAuthUrl() {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
        state: state
    });
    
    return {
        url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
        state: state
    };
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCode(code) {
    try {
        const params = new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: DISCORD_REDIRECT_URI
        });

        const response = await axios.post(`${DISCORD_API_BASE}/oauth2/token`, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error exchanging code:', error.response?.data || error.message);
        throw new Error('Failed to exchange authorization code');
    }
}

/**
 * Get user information from Discord API
 */
async function getUserInfo(accessToken) {
    try {
        const response = await axios.get(`${DISCORD_API_BASE}/users/@me`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting user info:', error.response?.data || error.message);
        throw new Error('Failed to get user information');
    }
}

/**
 * Get user's guilds from Discord API
 */
async function getUserGuilds(accessToken) {
    try {
        const response = await axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting user guilds:', error.response?.data || error.message);
        throw new Error('Failed to get user guilds');
    }
}

/**
 * Create a user session
 */
function createUserSession(userData, tokenData) {
    const sessionToken = generateSessionToken();
    const session = {
        user: userData,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
        createdAt: Date.now()
    };
    
    userSessions.set(sessionToken, session);
    return sessionToken;
}

/**
 * Get user session
 */
function getUserSession(sessionToken) {
    const session = userSessions.get(sessionToken);
    if (!session) return null;
    
    // Check if session has expired
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        userSessions.delete(sessionToken);
        return null;
    }
    
    return session;
}

/**
 * Delete user session
 */
function deleteUserSession(sessionToken) {
    userSessions.delete(sessionToken);
}

/**
 * Refresh access token
 */
async function refreshAccessToken(refreshToken) {
    try {
        const params = new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });

        const response = await axios.post(`${DISCORD_API_BASE}/oauth2/token`, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error refreshing token:', error.response?.data || error.message);
        throw new Error('Failed to refresh access token');
    }
}

/**
 * Periodic session cleanup
 */
function cleanupSessions() {
    const now = Date.now();
    for (const [token, session] of userSessions.entries()) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            userSessions.delete(token);
        }
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000).unref();

module.exports = {
    getAuthUrl,
    exchangeCode,
    getUserInfo,
    getUserGuilds,
    createUserSession,
    getUserSession,
    deleteUserSession,
    refreshAccessToken
};
