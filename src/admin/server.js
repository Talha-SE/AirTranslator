const http = require('http');
const fs = require('fs');
const path = require('path');
const nodeCron = require('node-cron');

// Import modules
const auth = require('./auth');
const analyticsHandler = require('./handlers/analytics');
const messagingHandler = require('./handlers/messaging');
const monetizationHandler = require('./handlers/monetization');
const paymentsHandler = require('./handlers/payments');
const serversHandler = require('./handlers/servers');
const feedbackHandler = require('./handlers/feedback');
const { generateLoginPage } = require('./templates/login');
const { generateDashboard } = require('./templates/dashboard');
const analyticsService = require('../services/analyticsService');
const monetizationService = require('../services/monetizationService');

const TOPGG_VOTE_BONUS_AMOUNT = 35;
const TOPGG_VOTE_TARGET_TTL_MS = 60 * 60 * 1000;

// Dashboard cache
const ANALYTICS_CACHE_TTL_MS = 60 * 1000; // 60s
let dashboardCache = { html: null, ts: 0 };

/**
 * Parse POST data helper
 */
function parsePostData(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    const data = {};
                    for (const [key, value] of params) {
                        data[key] = value;
                    }
                    resolve(data);
                } else {
                    resolve({ body });
                }
            } catch {
                resolve({ body });
            }
        });
    });
}

function parseServerIdFromTopggQuery(queryValue) {
    if (!queryValue) return null;
    try {
        const params = new URLSearchParams(String(queryValue));
        return params.get('guild') || params.get('serverId') || params.get('server_id') || null;
    } catch {
        return null;
    }
}

function getPendingTopggVoteTarget(userId) {
    if (!userId || !global.pendingTopggVoteTargets) return null;

    const entry = global.pendingTopggVoteTargets.get(String(userId));
    if (!entry?.serverId) {
        return null;
    }

    const timestamp = Number(entry.timestamp) || 0;
    if (timestamp && Date.now() - timestamp > TOPGG_VOTE_TARGET_TTL_MS) {
        global.pendingTopggVoteTargets.delete(String(userId));
        return null;
    }

    return String(entry.serverId);
}

/**
 * Serve static files
 */
function serveStatic(res, filePath, contentType) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

/**
 * Main HTTP server
 */
const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;
    
    try {
        // ===== CORS Preflight Handler =====
        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-ID',
                'Access-Control-Max-Age': '86400'
            });
            res.end();
            return;
        }
        
        // ===== Static Assets =====
        if (pathname.startsWith('/admin/public/')) {
            const fileName = pathname.replace('/admin/public/', '');
            const filePath = path.join(__dirname, 'public', fileName);
            
            const contentTypes = {
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon'
            };
            
            const ext = path.extname(fileName);
            const contentType = contentTypes[ext] || 'text/plain';
            
            serveStatic(res, filePath, contentType);
            return;
        }
        
        // ===== Health Check =====
        if (pathname === '/health' || pathname === '/') {
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                status: 'healthy',
                message: 'Discord Translator Bot is running!',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
                discord: global.discordClient?.isReady() ? 'connected' : 'disconnected'
            }));
            return;
        }
        
        if (pathname === '/ping') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('pong');
            return;
        }
        
        // ===== Authentication Routes =====
        if (pathname === '/admin/login' && req.method === 'POST') {
            try {
                const postData = await parsePostData(req);
                const remember = postData.remember === 'true';
                
                if (auth.verifyCredentials(postData.username, postData.password)) {
                    const sessionToken = auth.createSession(postData.username, remember);
                    
                    // Set cookie expiration based on remember me (30 days or 24 hours)
                    const maxAge = remember ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
                    
                    res.writeHead(302, {
                        'Set-Cookie': `session=${sessionToken}; HttpOnly; Path=/; Max-Age=${maxAge}`,
                        'Location': '/admin'
                    });
                    res.end();
                } else {
                    const loginPage = generateLoginPage('Invalid username or password');
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(loginPage);
                }
            } catch (error) {
                console.error('Login error:', error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error');
            }
            return;
        }
        
        if (pathname === '/admin/logout') {
            const sessionToken = auth.getSessionFromCookies(req.headers.cookie);
            if (sessionToken) {
                auth.destroySession(sessionToken);
            }
            
            res.writeHead(302, {
                'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0',
                'Location': '/admin'
            });
            res.end();
            return;
        }
        
        // ===== Public Webhook Endpoints (No Auth Required) =====
        
        // Vote webhook endpoint
        if ((pathname === '/webhook/vote' || pathname === '/webhooks/topgg') && req.method === 'POST') {
            console.log(`🔔 Webhook received at ${pathname}`);
            try {
                const data = await parsePostData(req);
                const body = typeof data === 'string' ? JSON.parse(data) : data;
                
                console.log('📊 Webhook data received:', body);
                
                const authHeader = req.headers.authorization;
                if (process.env.TOPGG_WEBHOOK_SECRET && authHeader !== process.env.TOPGG_WEBHOOK_SECRET) {
                    console.log('❌ Unauthorized webhook attempt');
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }
                
                const { user: userId, type, isWeekend, guild, query } = body;
                
                if (type === 'upvote') {
                    console.log(`📊 Received vote from user ${userId}${isWeekend ? ' (Weekend vote)' : ''}`);

                    const targetServerId = guild
                        || parseServerIdFromTopggQuery(query)
                        || getPendingTopggVoteTarget(userId)
                        || global.userServerTracking?.get(userId);

                    if (targetServerId) {
                        const fallbackUsername = `user_${String(userId).slice(-4)}`;
                        const userInfo = {
                            id: String(userId),
                            username: fallbackUsername,
                            displayName: fallbackUsername,
                        };

                        const result = await monetizationService.handleVoteReward(
                            userId,
                            targetServerId,
                            TOPGG_VOTE_BONUS_AMOUNT,
                            userInfo,
                            'topgg'
                        );
                        
                        if (result.success) {
                            console.log(`✅ Vote reward (${TOPGG_VOTE_BONUS_AMOUNT} translations) processed for user ${userId} in server ${targetServerId}`);
                            if (global.pendingTopggVoteTargets) {
                                global.pendingTopggVoteTargets.delete(String(userId));
                            }
                        }
                    } else {
                        console.log(`⚠️ No recent server found for user ${userId}`);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error processing vote webhook:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
            return;
        }
        
        // Payment webhook endpoint (public, no auth required)
        if (pathname === '/webhook/payment' && req.method === 'POST') {
            console.log('💳 Payment webhook received');
            try {
                const data = await parsePostData(req);
                const body = typeof data === 'string' ? JSON.parse(data) : data;
                
                console.log('💰 Payment data received:', body);
                
                // Create payment record with CORS headers
                await paymentsHandler.createPaymentFromBody(body, res);
                return;
            } catch (error) {
                console.error('Error processing payment webhook:', error);
                res.writeHead(500, { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
            return;
        }
        
        // Payment completion webhook (public, no auth required)
        if (pathname === '/webhook/payment-complete' && req.method === 'POST') {
            console.log('✅ Payment completion webhook received');
            try {
                const data = await parsePostData(req);
                const body = typeof data === 'string' ? JSON.parse(data) : data;
                
                console.log('💰 Payment completion data:', body);
                
                // Update payment status with CORS headers
                await paymentsHandler.updatePaymentStatusFromBody(body, res);
                return;
            } catch (error) {
                console.error('Error processing payment completion:', error);
                res.writeHead(500, { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
            return;
        }
        
        // ===== Protected Routes (Require Authentication) =====
        const sessionToken = auth.getSessionFromCookies(req.headers.cookie);
        
        if (!auth.isValidSession(sessionToken)) {
            // Unauthenticated
            if (pathname === '/admin' || pathname.startsWith('/admin/')) {
                if (pathname === '/admin') {
                    const loginPage = generateLoginPage();
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(loginPage);
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                }
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
            return;
        }
        
        // ===== Authenticated Routes =====
        
        // Dashboard
        if (pathname === '/admin') {
            const urlParts = new URL(req.url, `http://${req.headers.host}`);
            const tab = urlParts.searchParams.get('tab') || 'analytics';
            
            // Generate dashboard with current tab (no caching for tab-specific content)
            const analytics = analyticsService.getAnalytics();
            const client = global.discordClient;
            const html = await generateDashboard(analytics, client, tab);
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
            return;
        }
        
        // Analytics endpoints
        if (pathname === '/admin/metrics' && req.method === 'GET') {
            await analyticsHandler.getMetrics(req, res);
            return;
        }

        if (pathname === '/admin/feedback/data' && req.method === 'GET') {
            await feedbackHandler.getFeedbackData(req, res);
            return;
        }

        if (pathname === '/admin/feedback/settings' && req.method === 'POST') {
            await feedbackHandler.updateFeedbackSettings(req, res);
            return;
        }

        if (pathname === '/admin/feedback/delete' && req.method === 'POST') {
            await feedbackHandler.deleteSelectedFeedback(req, res);
            return;
        }

        if (pathname === '/admin/feedback/delete-all' && req.method === 'POST') {
            await feedbackHandler.deleteAllFeedback(req, res);
            return;
        }
        
        // Server endpoints
        if (pathname === '/admin/servers' && req.method === 'GET') {
            await serversHandler.getServers(req, res);
            return;
        }
        
        if (pathname.startsWith('/admin/servers/') && pathname.endsWith('/members') && req.method === 'GET') {
            const serverId = pathname.split('/')[3];
            await serversHandler.getServerMembers(req, res, serverId);
            return;
        }
        
        if (pathname === '/admin/servers/leave' && req.method === 'POST') {
            await serversHandler.leaveServer(req, res);
            return;
        }
        
        // Messaging endpoints
        if (pathname === '/admin/send-message' && req.method === 'POST') {
            await messagingHandler.handleSendMessage(req, res);
            return;
        }
        
        if (pathname === '/admin/schedule-message' && req.method === 'POST') {
            await messagingHandler.handleScheduleMessage(req, res);
            return;
        }
        
        if (pathname === '/admin/scheduled-messages' && req.method === 'GET') {
            await messagingHandler.getScheduledMessages(req, res);
            return;
        }
        
        if (pathname.startsWith('/admin/cancel-scheduled/') && req.method === 'POST') {
            const jobId = pathname.split('/').pop();
            await messagingHandler.handleCancelScheduled(req, res, jobId);
            return;
        }
        
        if (pathname === '/admin/send-auto-setup' && req.method === 'POST') {
            await messagingHandler.handleAutoSetup(req, res);
            return;
        }

        if (pathname === '/admin/messaging/campaign-settings' && req.method === 'GET') {
            await messagingHandler.getCampaignSettings(req, res);
            return;
        }

        if (pathname === '/admin/messaging/campaign-settings' && req.method === 'POST') {
            await messagingHandler.updateCampaignSettings(req, res);
            return;
        }
        
        // Monetization endpoints
        if (pathname === '/admin/monetization/settings' && req.method === 'POST') {
            await monetizationHandler.updateSettings(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/exempt/add' && req.method === 'POST') {
            await monetizationHandler.addExemptServer(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/exempt/remove' && req.method === 'POST') {
            await monetizationHandler.removeExemptServer(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/restrict/add' && req.method === 'POST') {
            await monetizationHandler.addRestrictedServer(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/restrict/remove' && req.method === 'POST') {
            await monetizationHandler.removeRestrictedServer(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/reset-count' && req.method === 'POST') {
            await monetizationHandler.resetServerCount(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/custom-limit' && req.method === 'POST') {
            await monetizationHandler.setCustomLimit(req, res);
            return;
        }

        if (pathname === '/admin/monetization/premium/join-date' && req.method === 'POST') {
            await monetizationHandler.setPremiumJoinDate(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/premium/approve' && req.method === 'POST') {
            await monetizationHandler.approvePremiumRequest(req, res, sessionToken, auth.getSession);
            return;
        }
        
        if (pathname === '/admin/monetization/premium/reject' && req.method === 'POST') {
            await monetizationHandler.rejectPremiumRequest(req, res, sessionToken, auth.getSession);
            return;
        }
        
        if (pathname === '/admin/monetization/vote/delete' && req.method === 'POST') {
            await monetizationHandler.deleteVoteRecord(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/recent-votes' && req.method === 'GET') {
            await monetizationHandler.getRecentVotes(req, res, reqUrl);
            return;
        }
        
        if (pathname === '/admin/monetization/bulk/restrict-all' && req.method === 'POST') {
            await monetizationHandler.bulkRestrictAll(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/bulk/remove-restrictions' && req.method === 'POST') {
            await monetizationHandler.bulkRemoveRestrictions(req, res);
            return;
        }
        
        if (pathname === '/admin/monetization/bulk/reset-counts' && req.method === 'POST') {
            await monetizationHandler.bulkResetCounts(req, res);
            return;
        }
        
        // Payment endpoints
        if (pathname === '/admin/api/payments' && req.method === 'GET') {
            await paymentsHandler.getPayments(req, res);
            return;
        }
        
        if (pathname === '/admin/api/payments/stats' && req.method === 'GET') {
            await paymentsHandler.getPaymentStats(req, res);
            return;
        }
        
        if (pathname === '/admin/api/payments/create' && req.method === 'POST') {
            await paymentsHandler.createPayment(req, res);
            return;
        }
        
        if (pathname === '/admin/api/payments/update' && req.method === 'POST') {
            await paymentsHandler.updatePaymentStatus(req, res);
            return;
        }
        
        if (pathname === '/admin/api/payments/delete' && req.method === 'DELETE') {
            await paymentsHandler.deletePayment(req, res);
            return;
        }
        
        // 404 - Not Found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        
    } catch (error) {
        console.error('Server error:', error);
        try {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        } catch (err) {
            // Response already sent
        }
    }
});

server.on('error', (error) => {
    console.error('HTTP Server error:', error);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🚀 AirTranslator Admin Panel Started');
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
    
    if (process.env.NODE_ENV === 'production') {
        const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://airtranslator.onrender.com';
        console.log(`🌐 Public URL: ${renderUrl}/admin`);
    }
    
    console.log(`${'='.repeat(60)}\n`);
});

// Periodic exemption expiry checker - runs every 5 minutes
const exemptionExpiryJob = nodeCron.schedule('*/5 * * * *', async () => {
    try {
        console.log('⏰ Running periodic exemption expiry check...');
        await monetizationService.checkAndExpireExemptions();
    } catch (error) {
        console.error('❌ Error in exemption expiry job:', error);
    }
});

console.log('✅ Exemption expiry checker scheduled (every 5 minutes)');

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    exemptionExpiryJob.stop();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

module.exports = server;
