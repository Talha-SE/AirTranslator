const http = require('http');
const userAuthService = require('./userAuthService');
const userDashboardService = require('./userDashboardService');

/**
 * Parse cookies from header
 */
function parseCookies(cookieHeader) {
    if (!cookieHeader) return {};
    
    const cookies = {};
    cookieHeader.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
            cookies[key] = decodeURIComponent(value);
        }
    });
    return cookies;
}

/**
 * Parse query parameters
 */
function parseQueryParams(url) {
    const queryString = url.split('?')[1];
    if (!queryString) return {};
    
    const params = {};
    queryString.split('&').forEach(param => {
        const [key, value] = param.split('=');
        if (key && value) {
            params[key] = decodeURIComponent(value);
        }
    });
    return params;
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:5173',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
}

/**
 * Handle OPTIONS requests (CORS preflight)
 */
function handleCORS(res) {
    res.writeHead(200, {
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:5173',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
}

/**
 * Read request body
 */
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Create user API routes
 */
function createUserApiRoutes(botClient) {
    return async function handleRequest(req, res, parsedUrl) {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            handleCORS(res);
            return true;
        }

        // Get Discord OAuth authorization URL
        if (parsedUrl.pathname === '/api/auth/discord' && req.method === 'GET') {
            try {
                const { url, state } = userAuthService.getAuthUrl();
                sendJSON(res, 200, { authUrl: url, state });
            } catch (error) {
                console.error('Error generating auth URL:', error);
                sendJSON(res, 500, { error: 'Failed to generate auth URL' });
            }
            return true;
        }

        // Handle Discord OAuth callback
        if (parsedUrl.pathname === '/api/auth/callback' && req.method === 'POST') {
            try {
                const body = await readRequestBody(req);
                const { code } = body;

                if (!code) {
                    sendJSON(res, 400, { error: 'Missing authorization code' });
                    return true;
                }

                // Exchange code for tokens
                const tokenData = await userAuthService.exchangeCode(code);
                
                // Get user info
                const userInfo = await userAuthService.getUserInfo(tokenData.access_token);
                
                // Create session
                const sessionToken = userAuthService.createUserSession(userInfo, tokenData);
                
                // Send session token
                sendJSON(res, 200, {
                    success: true,
                    sessionToken,
                    user: {
                        id: userInfo.id,
                        username: userInfo.username,
                        discriminator: userInfo.discriminator,
                        avatar: userInfo.avatar,
                        global_name: userInfo.global_name
                    }
                });
            } catch (error) {
                console.error('Error handling OAuth callback:', error);
                sendJSON(res, 500, { error: 'Authentication failed', details: error.message });
            }
            return true;
        }

        // Get current user
        if (parsedUrl.pathname === '/api/user/me' && req.method === 'GET') {
            try {
                const cookies = parseCookies(req.headers.cookie);
                const sessionToken = cookies.session;

                if (!sessionToken) {
                    sendJSON(res, 401, { error: 'Not authenticated' });
                    return true;
                }

                const session = userAuthService.getUserSession(sessionToken);
                if (!session) {
                    sendJSON(res, 401, { error: 'Session expired' });
                    return true;
                }

                sendJSON(res, 200, {
                    user: session.user
                });
            } catch (error) {
                console.error('Error getting user:', error);
                sendJSON(res, 500, { error: 'Failed to get user' });
            }
            return true;
        }

        // Get user's guilds (only those where bot is present)
        if (parsedUrl.pathname === '/api/user/guilds' && req.method === 'GET') {
            try {
                const cookies = parseCookies(req.headers.cookie);
                const sessionToken = cookies.session;

                if (!sessionToken) {
                    sendJSON(res, 401, { error: 'Not authenticated' });
                    return true;
                }

                const session = userAuthService.getUserSession(sessionToken);
                if (!session) {
                    sendJSON(res, 401, { error: 'Session expired' });
                    return true;
                }

                // Get user guilds from Discord
                const userGuilds = await userAuthService.getUserGuilds(session.accessToken);
                
                // Filter to only show guilds where bot is present
                const botGuilds = userDashboardService.getUserBotGuilds(userGuilds, botClient);
                
                sendJSON(res, 200, { guilds: botGuilds });
            } catch (error) {
                console.error('Error getting user guilds:', error);
                sendJSON(res, 500, { error: 'Failed to get guilds', details: error.message });
            }
            return true;
        }

        // Get channels for a specific guild
        if (parsedUrl.pathname.startsWith('/api/guilds/') && parsedUrl.pathname.endsWith('/channels') && req.method === 'GET') {
            try {
                const cookies = parseCookies(req.headers.cookie);
                const sessionToken = cookies.session;

                if (!sessionToken) {
                    sendJSON(res, 401, { error: 'Not authenticated' });
                    return true;
                }

                const session = userAuthService.getUserSession(sessionToken);
                if (!session) {
                    sendJSON(res, 401, { error: 'Session expired' });
                    return true;
                }

                // Extract guild ID from URL
                const guildId = parsedUrl.pathname.split('/')[3];
                
                // Get channels for the guild
                const channels = await userDashboardService.getGuildChannels(guildId, botClient);
                
                sendJSON(res, 200, { channels });
            } catch (error) {
                console.error('Error getting guild channels:', error);
                sendJSON(res, 500, { error: 'Failed to get channels', details: error.message });
            }
            return true;
        }

        // Get server configuration
        if (parsedUrl.pathname.startsWith('/api/guilds/') && parsedUrl.pathname.endsWith('/config') && req.method === 'GET') {
            try {
                const cookies = parseCookies(req.headers.cookie);
                const sessionToken = cookies.session;

                if (!sessionToken) {
                    sendJSON(res, 401, { error: 'Not authenticated' });
                    return true;
                }

                const session = userAuthService.getUserSession(sessionToken);
                if (!session) {
                    sendJSON(res, 401, { error: 'Session expired' });
                    return true;
                }

                // Extract guild ID from URL
                const guildId = parsedUrl.pathname.split('/')[3];
                
                // Get server configuration
                const config = await userDashboardService.getServerConfig(guildId);
                
                sendJSON(res, 200, { config });
            } catch (error) {
                console.error('Error getting server config:', error);
                sendJSON(res, 500, { error: 'Failed to get configuration', details: error.message });
            }
            return true;
        }

        // Update server configuration
        if (parsedUrl.pathname.startsWith('/api/guilds/') && parsedUrl.pathname.endsWith('/config') && req.method === 'PUT') {
            try {
                const cookies = parseCookies(req.headers.cookie);
                const sessionToken = cookies.session;

                if (!sessionToken) {
                    sendJSON(res, 401, { error: 'Not authenticated' });
                    return true;
                }

                const session = userAuthService.getUserSession(sessionToken);
                if (!session) {
                    sendJSON(res, 401, { error: 'Session expired' });
                    return true;
                }

                // Extract guild ID from URL
                const guildId = parsedUrl.pathname.split('/')[3];
                
                // Get request body
                const body = await readRequestBody(req);
                
                // Update server configuration
                const config = await userDashboardService.updateServerConfig(guildId, body);
                
                sendJSON(res, 200, { success: true, config });
            } catch (error) {
                console.error('Error updating server config:', error);
                sendJSON(res, 500, { error: 'Failed to update configuration', details: error.message });
            }
            return true;
        }

        // Logout
        if (parsedUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
            try {
                const cookies = parseCookies(req.headers.cookie);
                const sessionToken = cookies.session;

                if (sessionToken) {
                    userAuthService.deleteUserSession(sessionToken);
                }

                sendJSON(res, 200, { success: true });
            } catch (error) {
                console.error('Error logging out:', error);
                sendJSON(res, 500, { error: 'Failed to logout' });
            }
            return true;
        }

        return false; // Route not handled
    };
}

module.exports = {
    createUserApiRoutes
};
