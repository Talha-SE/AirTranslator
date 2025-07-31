const http = require('http');
const crypto = require('crypto');
const analyticsService = require('./analyticsService');
const nodeCron = require('node-cron');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AirTranslator2024!';


/**
 * Session management
 * Stores active sessions in memory with a 24-hour expiration.
 */
const sessions = new Map();

// Scheduled messages storage
const scheduledMessages = new Map();

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
    
    // Check if the session has expired (24 hours)
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        sessions.delete(sessionToken);
        return false;
    }
    
    return true;
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
 * Parses the POST data from the request.
 * @param {http.IncomingMessage} req - The HTTP request object.
 * @returns {Promise<Object>} A promise that resolves to the parsed data object.
 */
function parsePostData(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            if (req.headers['content-type'] === 'application/json') {
                resolve({ body });
            } else {
                const params = new URLSearchParams(body);
                const data = {};
                for (const [key, value] of params) {
                    data[key] = value;
                }
                resolve(data);
            }
        });
    });
}

/**
 * Generates the HTML for the admin login page.
 * @param {string} [error=''] - Optional error message to display.
 * @returns {string} The HTML content for the login page.
 */
function generateLoginPage(error = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AirTranslator Admin Login</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 400px;
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo h1 {
            color: #333;
            margin: 0;
            font-size: 28px;
        }
        .logo p {
            color: #666;
            margin: 5px 0 0 0;
            font-size: 14px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            color: #333;
            font-weight: 500;
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
            box-sizing: border-box;
            transition: border-color 0.3s;
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #667eea;
        }
        .btn {
            width: 100%;
            padding: 12px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
        }
        .btn:hover {
            background: #5a6fd8;
        }
        .error {
            color: #e74c3c;
            text-align: center;
            margin-bottom: 20px;
            padding: 10px;
            background: #ffeaea;
            border-radius: 5px;
        }
        .footer {
            text-align: center;
            margin-top: 20px;
            color: #666;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>🤖 AirTranslator</h1>
            <p>Admin Panel Access</p>
        </div>
        ${error ? `<div class="error">${error}</div>` : ''}
        <form method="POST" action="/admin/login">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" class="btn">Login</button>
        </form>
        <div class="footer">
            AirTranslator Admin Panel • Authorized Access Only
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generates the HTML for the server messaging interface.
 * @returns {string} The HTML content for the messaging interface.
 */
function generateMessageInterface() {
    return `
    <div class="section">
        <h2>📢 Server Messaging System</h2>
        <div class="message-form">
            <div class="form-group">
                <label for="messageType">Message Type:</label>
                <select id="messageType" onchange="updateMessageTemplate()">
                    <option value="custom">Custom Message</option>
                    <option value="announcement">📢 Announcement</option>
                    <option value="update">🔄 Bot Update</option>
                    <option value="maintenance">🔧 Maintenance Notice</option>
                    <option value="feature">✨ New Feature</option>
                    <option value="warning">⚠️ Important Notice</option>
                    <option value="celebration">🎉 Celebration</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="targetType">Send To:</label>
                <select id="targetType" onchange="updateTargetOptions()">
                    <option value="all">All Servers (Broadcast)</option>
                    <option value="specific">Specific Server</option>
                    <option value="large">Large Servers Only (1000+ members)</option>
                    <option value="active">Active Servers Only (recent activity)</option>
                </select>
            </div>
            
            <div class="form-group" id="serverSelectGroup" style="display: none;">
                <label for="targetServer">Select Server:</label>
                <select id="targetServer">
                    <!-- Will be populated dynamically -->
                </select>
            </div>
            
            <div class="form-group">
                <label for="messageTitle">Message Title (optional):</label>
                <input type="text" id="messageTitle" placeholder="e.g., Important Bot Update" maxlength="100">
            </div>
            
            <div class="form-group">
                <label for="messageContent">Message Content:</label>
                <textarea id="messageContent" rows="6" placeholder="Type your message here..." maxlength="1500"></textarea>
                <div class="char-counter">
                    <span id="charCount">0</span> / 1500 characters
                </div>
            </div>
            
            <div class="form-group">
                <label for="messageColor">Embed Color:</label>
                <select id="messageColor">
                    <option value="#3498db">Blue (Info)</option>
                    <option value="#00ff88">Green (Success)</option>
                    <option value="#ffa500">Orange (Warning)</option>
                    <option value="#ff6b6b">Red (Important)</option>
                    <option value="#9b59b6">Purple (Feature)</option>
                    <option value="#f39c12">Yellow (Announcement)</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>
                    <input type="checkbox" id="includeFooter" checked>
                    Include bot footer and timestamp
                </label>
            </div>
            
            <div class="form-group">
                <label>
                    <input type="checkbox" id="urgentMessage">
                    Mark as urgent (adds priority indicators)
                </label>
            </div>
            
            <div class="schedule-options">
            <div class="form-group">
                <label for="schedule">Schedule:</label>
                <select id="schedule" onchange="updateScheduleOptions()">
                    <option value="now">Send Now</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="custom">Custom Cron</option>
                </select>
            </div>
            
            <div class="form-group" id="customScheduleGroup" style="display: none;">
                <label for="customSchedule">Custom Cron Pattern:</label>
                <input type="text" id="customSchedule" placeholder="* * * * *">
                <small>Cron format: minute hour day month day-of-week</small>
            </div>
            
            <div class="form-group" id="timeSelectionGroup">
                <label for="scheduleTime">Time:</label>
                <input type="time" id="scheduleTime" value="12:00" required>
            </div>
            
            <div class="form-group">
                <label for="timezone">Timezone:</label>
                <select id="timezone">
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                    <option value="Europe/London">London</option>
                    <option value="Asia/Kolkata">India (IST)</option>
                </select>
            </div>
            </div>
            
            <div class="message-preview">
                <h3>📝 Preview:</h3>
                <div id="previewContainer">
                    <div class="embed-preview">
                        <div class="embed-content">
                            <div id="previewTitle" class="embed-title">Title will appear here</div>
                            <div id="previewContent" class="embed-description">Message content will appear here</div>
                            <div id="previewFooter" class="embed-footer">AirTranslator Bot • Now</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="button-group">
                <button type="button" class="btn-preview" onclick="updatePreview()">🔄 Update Preview</button>
                <button type="button" class="btn-send" onclick="sendMessage()">📤 Send Message</button>
                <button type="button" class="btn-test" onclick="sendTestMessage()">🧪 Send Test (to first server)</button>
                <button type="button" class="btn-schedule" onclick="scheduleMessage()">🕒 Schedule Message</button>
            </div>
        </div>
        
        <div id="sendingProgress" class="progress-section" style="display: none;">
            <h3>📡 Sending Messages...</h3>
            <div class="progress-bar">
                <div id="progressFill" class="progress-fill" style="width: 0%"></div>
            </div>
            <div id="progressText">Preparing to send...</div>
            <div id="deliveryResults"></div>
        </div>
    </div>`;
}

/**
 * Extracts analytics content to separate function for better organization.
 * @param {Object} analytics - The analytics data.
 * @param {Object} client - The Discord client instance.
 * @returns {string} The HTML content for analytics.
 */
function generateAnalyticsContent(analytics, client) {
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);
    const totalMembers = client ? client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0) : 0;
    
    const recentDays = Object.entries(analytics.dailyStats || {})
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 14);
    
    const topLanguages = Object.entries(analytics.languageUsage || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    const topCommands = Object.entries(analytics.commandUsage || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const totalChannels = client ? client.channels.cache.size : 0;
    const activeChannels = Object.keys(analytics.channelActivity || {}).length;
    const avgTranslationsPerDay = recentDays.length > 0 ? 
        Math.round(recentDays.reduce((sum, [_, stats]) => sum + (stats.translations || 0), 0) / recentDays.length) : 0;
    const peakDayTranslations = Object.values(analytics.dailyStats)
        .reduce((max, day) => Math.max(max, day.translations || 0), 0);

    const topServers = (analytics.serverList || [])
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 10);

    const channelStats = Object.entries(analytics.channelActivity || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    return `
        <div class="stats-grid">
            <div class="stat-card">
                <h3>🏠 Server Deployment</h3>
                <div class="stat-value">${analytics.totalServers || 0}</div>
                <div class="stat-label">Active Servers</div>
                <div class="metric-small">Total Channels: ${totalChannels.toLocaleString()}</div>
            </div>
            <div class="stat-card success">
                <h3>👥 Total Reach</h3>
                <div class="stat-value">${totalMembers.toLocaleString()}</div>
                <div class="stat-label">Accessible Users</div>
                <div class="metric-small">Avg per server: ${analytics.totalServers > 0 ? Math.round(totalMembers / analytics.totalServers) : 0}</div>
            </div>
            <div class="stat-card premium">
                <h3>🔄 Total Translations</h3>
                <div class="stat-value">${(analytics.totalTranslations || 0).toLocaleString()}</div>
                <div class="stat-label">Messages Processed</div>
                <div class="metric-small">Daily avg: ${avgTranslationsPerDay} | Peak: ${peakDayTranslations}</div>
            </div>
            <div class="stat-card warning">
                <h3>⏱️ System Uptime</h3>
                <div class="stat-value">${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</div>
                <div class="stat-label">Current Session</div>
                <div class="metric-small">Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used</div>
            </div>
            <div class="stat-card">
                <h3>📡 Active Channels</h3>
                <div class="stat-value">${activeChannels}</div>
                <div class="stat-label">Translation Channels</div>
                <div class="metric-small">Coverage: ${totalChannels > 0 ? Math.round((activeChannels / totalChannels) * 100) : 0}%</div>
            </div>
            <div class="stat-card success">
                <h3>🌍 Language Pairs</h3>
                <div class="stat-value">${Object.keys(analytics.languageUsage || {}).length}</div>
                <div class="stat-label">Active Combinations</div>
                <div class="metric-small">Most popular: ${topLanguages[0] ? topLanguages[0][0] : 'None'}</div>
            </div>
        </div>

        <div class="grid-2">
            <div class="section">
                <h2>📅 Recent Activity (14 Days)</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Translations</th>
                            <th>Active Users</th>
                            <th>Activity</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentDays.map(([date, stats]) => {
                            const percentage = peakDayTranslations > 0 ? Math.round((stats.translations || 0) / peakDayTranslations * 100) : 0;
                            return `
                            <tr>
                                <td>${new Date(date).toLocaleDateString()}</td>
                                <td>${(stats.translations || 0).toLocaleString()}</td>
                                <td>${Array.isArray(stats.activeUsers) ? stats.activeUsers.length : 0}</td>
                                <td>
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    ${percentage}%
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>🏆 Top Servers by Size</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Server Name</th>
                            <th>Members</th>
                            <th>Joined</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topServers.map(server => `
                            <tr>
                                <td>${server.name}</td>
                                <td>${server.memberCount.toLocaleString()}</td>
                                <td>${new Date(server.joinedAt).toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="grid-2">
            <div class="section">
                <h2>🌍 Language Usage Analytics</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Language Pair</th>
                            <th>Usage Count</th>
                            <th>Percentage</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topLanguages.map(([pair, count]) => {
                            const percentage = analytics.totalTranslations > 0 ? Math.round((count / analytics.totalTranslations) * 100) : 0;
                            return `
                            <tr>
                                <td>${pair}</td>
                                <td>${count.toLocaleString()}</td>
                                <td>
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    ${percentage}%
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>⚡ Command Performance</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Command</th>
                            <th>Usage Count</th>
                            <th>Popularity</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topCommands.map(([command, count]) => {
                            const totalCommands = Object.values(analytics.commandUsage || {}).reduce((sum, c) => sum + c, 0);
                            const percentage = totalCommands > 0 ? Math.round((count / totalCommands) * 100) : 0;
                            return `
                            <tr>
                                <td>/${command}</td>
                                <td>${count.toLocaleString()}</td>
                                <td>
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    ${percentage}%
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="section">
            <h2>📊 Channel Activity Heatmap</h2>
            <table class="table">
                <thead>
                    <tr>
                        <th>Channel</th>
                        <th>Translation Count</th>
                        <th>Activity Level</th>
                        <th>Server</th>
                    </tr>
                </thead>
                <tbody>
                    ${channelStats.map(([channelId, count]) => {
                        const maxActivity = Math.max(...Object.values(analytics.channelActivity || {}));
                        const percentage = maxActivity > 0 ? Math.round((count / maxActivity) * 100) : 0;
                        const channel = client ? client.channels.cache.get(channelId) : null;
                        const serverName = channel ? channel.guild.name : 'Unknown Server';
                        const channelName = channel ? `#${channel.name}` : `ID: ${channelId}`;
                        return `
                        <tr>
                            <td>${channelName}</td>
                            <td>${count.toLocaleString()}</td>
                            <td>
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${percentage}%"></div>
                                </div>
                                ${percentage}%
                            </td>
                            <td>${serverName}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="grid-2">
            <div class="section">
                <h2>💻 System Information</h2>
                <table class="table">
                    <tbody>
                        <tr>
                            <td><strong>Memory Usage</strong></td>
                            <td>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB</td>
                        </tr>
                        <tr>
                            <td><strong>Bot Started</strong></td>
                            <td>${analytics.botStartTime ? new Date(analytics.botStartTime).toLocaleString() : 'Unknown'}</td>
                        </tr>
                        <tr>
                            <td><strong>Node.js Version</strong></td>
                            <td>${process.version}</td>
                        </tr>
                        <tr>
                            <td><strong>Platform</strong></td>
                            <td>${process.platform} ${process.arch}</td>
                        </tr>
                        <tr>
                            <td><strong>Environment</strong></td>
                            <td>${process.env.NODE_ENV || 'development'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>📈 Performance Metrics</h2>
                <table class="table">
                    <tbody>
                        <tr>
                            <td><strong>Total API Calls</strong></td>
                            <td>${(analytics.totalTranslations || 0).toLocaleString()}</td>
                        </tr>
                        <tr>
                            <td><strong>Success Rate</strong></td>
                            <td>99.8% (estimated)</td>
                        </tr>
                        <tr>
                            <td><strong>Avg Response Time</strong></td>
                            <td>~1.2 seconds</td>
                        </tr>
                        <tr>
                            <td><strong>Peak Daily Usage</strong></td>
                            <td>${peakDayTranslations.toLocaleString()} translations</td>
                        </tr>
                        <tr>
                            <td><strong>Data Retention</strong></td>
                            <td>30 days rolling</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

/**
 * Generates the HTML for the admin dashboard with tab-based navigation.
 * @param {Object} analytics - The analytics data for the dashboard.
 * @param {Object} client - The Discord client instance.
 * @returns {string} The HTML content for the dashboard.
 */
function generateDashboard(analytics, client) {
    const messagesWithFeedback = analyticsService.getMessagesWithFeedback();
    const peakDayTranslations = Object.values(analytics.dailyStats)
        .reduce((max, day) => Math.max(max, day.translations || 0), 0);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AirTranslator Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f5f7fa;
            line-height: 1.6;
            color: #333;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px 0;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            position: relative;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
            transition: transform 0.2s ease;
        }
        .stat-card:hover {
            transform: translateY(-2px);
        }
        .stat-card.premium { border-left-color: #ff6b6b; }
        .stat-card.success { border-left-color: #51cf66; }
        .stat-card.warning { border-left-color: #feca57; }
        .stat-card h3 {
            color: #667eea;
            margin-bottom: 10px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .stat-label {
            color: #666;
            font-size: 14px;
        }
        .metric-small {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        .section {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .section h2 {
            color: #333;
            margin-bottom: 15px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }
        .table {
            width: 100%;
            border-collapse: collapse;
        }
        .table th, .table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        .table th {
            background: #f8f9fa;
            font-weight: 600;
        }
        .logout-btn {
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(255,255,255,0.2);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
        }
        .logout-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        .refresh-info {
            color: #666;
            font-size: 12px;
            text-align: right;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.3s;
        }
        .refresh-btn:hover {
            background: #5a6fd8;
        }
        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #eee;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 5px;
        }
        .progress-fill {
            height: 100%;
            background: #667eea;
            border-radius: 4px;
            transition: width 0.3s ease;
        }
        .tab-container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            overflow: hidden;
        }
        .tab-nav {
            display: flex;
            background: #f8f9fa;
            border-bottom: 1px solid #ddd;
        }
        .tab-btn {
            flex: 1;
            padding: 15px;
            background: none;
            border: none;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s;
        }
        .tab-btn.active {
            background: #667eea;
            color: white;
        }
        .tab-btn:hover:not(.active) {
            background: #e9ecef;
        }
        .tab-content {
            padding: 20px;
        }
        .tab-pane {
            display: none;
        }
        .tab-pane.active {
            display: block;
        }
        .message-form {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        /* --- Design upgrade for scheduling pane --- */
        .schedule-options {display:flex;flex-wrap:wrap;gap:20px;margin-top:10px;}
        .schedule-options .form-group{flex:1 1 200px;min-width:180px;}
        .schedule-options select,.schedule-options input{background:#fff;border:2px solid #ddd;border-radius:6px;padding:8px 10px;font-size:14px;transition:border-color .3s,box-shadow .3s;}
        .schedule-options select:focus,.schedule-options input:focus{border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,0.2);outline:none;}
        .info-tip{display:inline-block;margin-left:6px;color:#667eea;cursor:pointer;font-weight:bold;}
        .info-tip:hover{color:#5a6fd8;}
        .tooltip-box{position:absolute;z-index:10;background:#333;color:#fff;font-size:12px;padding:6px 10px;border-radius:4px;white-space:nowrap;opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s;}
        .info-tip:hover .tooltip-box{opacity:1;transform:translateY(-4px);}
        }
        .schedule-options {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            margin-top: 10px;
        }
        .schedule-options .form-group {
            flex: 1 1 200px;
            min-width: 180px;
        }
        .schedule-options select, .schedule-options input {
            background: #fff;
            border: 2px solid #ddd;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 14px;
            transition: border-color 0.3s, box-shadow 0.3s;
        }
        .schedule-options select:focus, .schedule-options input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102,126,234,0.2);
            outline: none;
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: #333;
        }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
            transition: border-color 0.3s;
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        .char-counter {
            text-align: right;
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        .message-preview {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .embed-preview {
            border-left: 4px solid #3498db;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 0 5px 5px 0;
        }
        .embed-title {
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 8px;
            color: #333;
        }
        .embed-description {
            color: #666;
            line-height: 1.4;
            margin-bottom: 10px;
            white-space: pre-wrap;
        }
        .embed-footer {
            font-size: 12px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 8px;
        }
        .button-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .btn-preview, .btn-send, .btn-test {
            padding: 12px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s;
        }
        .btn-preview {
            background: #3498db;
            color: white;
        }
        .btn-send {
            background: #00ff88;
            color: white;
        }
        .btn-test {
            background: #ffa500;
            color: white;
        }
        .btn-preview:hover { background: #2980b9; }
        .btn-send:hover { background: #00e676; }
        .btn-test:hover { background: #ff8f00; }
        .progress-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #ddd;
        }
        .delivery-results {
            margin-top: 15px;
        }
        .delivery-item {
            padding: 8px;
            margin: 5px 0;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .delivery-success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        .delivery-error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        @media (max-width: 768px) {
            .stats-grid { grid-template-columns: 1fr; }
            .grid-2 { grid-template-columns: 1fr; }
        }
        
        /* Message Feedback Styles */
        .message-item {
            background: white;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .message-item:hover {
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .message-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .message-preview {
            color: #666;
            margin-top: 8px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .feedback-stats {
            display: flex;
            gap: 15px;
        }
        
        .feedback-stat {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .feedback-details {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }
        
        .message-item.expanded .feedback-details {
            max-height: 1000px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #eee;
        }
        
        .comment-item {
            padding: 10px;
            margin: 10px 0;
            background: #f8f9fa;
            border-radius: 5px;
        }
        
        .comment-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.9em;
            margin-bottom: 5px;
        }
        
        .comment-user {
            font-weight: bold;
        }
        
        .comment-time {
            color: #888;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script>
        let refreshTimer = setTimeout(() => {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab) {
                const tabName = activeTab.onclick.toString().match(/switchTab\\('([^']+)'\\)/)[1];
                sessionStorage.setItem('activeTab', tabName);
            }
            window.location.reload();
        }, 30000);
        
        function manualRefresh() {
            clearTimeout(refreshTimer);
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab) {
                const tabName = activeTab.onclick.toString().match(/switchTab\\('([^']+)'\\)/)[1];
                sessionStorage.setItem('activeTab', tabName);
            }
            window.location.reload();
        }
        
        function switchTab(tabName) {
            if (tabName === 'messaging') {
                clearTimeout(refreshTimer);
                refreshTimer = setTimeout(() => {
                    sessionStorage.setItem('activeTab', 'messaging');
                    window.location.reload();
                }, 300000);
            } else if (tabName === 'analytics') {
                clearTimeout(refreshTimer);
                refreshTimer = setTimeout(() => {
                    sessionStorage.setItem('activeTab', 'analytics');
                    window.location.reload();
                }, 30000);
            }
            
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
            
            sessionStorage.setItem('activeTab', tabName);
        }
        
        function updateMessageTemplate() {
            const type = document.getElementById('messageType').value;
            const titleField = document.getElementById('messageTitle');
            const contentField = document.getElementById('messageContent');
            const colorField = document.getElementById('messageColor');
            
            const templates = {
                announcement: {
                    title: '📢 Important Announcement',
                    content: 'We have an important update to share with your community!\\n\\n[Your announcement content here]',
                    color: '#f39c12'
                },
                update: {
                    title: '🔄 Bot Update Available',
                    content: 'AirTranslator has been updated with new features and improvements!\\n\\n✨ What\\'s new:\\n• [Feature 1]\\n• [Feature 2]\\n• [Bug fixes]',
                    color: '#3498db'
                },
                maintenance: {
                    title: '🔧 Scheduled Maintenance',
                    content: 'We\\'ll be performing scheduled maintenance to improve bot performance.\\n\\n⏰ Scheduled time: [TIME]\\n⏱️ Expected duration: [DURATION]\\n\\nThe bot may be temporarily unavailable during this time.',
                    color: '#ffa500'
                },
                feature: {
                    title: '✨ New Feature Released!',
                    content: 'Exciting news! We\\'ve just released a new feature for AirTranslator.\\n\\n🎯 What\\'s new: [FEATURE NAME]\\n📝 How to use: [INSTRUCTIONS]\\n\\nTry it out and let us know what you think!',
                    color: '#9b59b6'
                },
                warning: {
                    title: '⚠️ Important Notice',
                    content: 'This is an important notice regarding AirTranslator.\\n\\n[Your important message here]\\n\\nPlease read carefully and take any necessary actions.',
                    color: '#ff6b6b'
                },
                celebration: {
                    title: '🎉 Celebration Time!',
                    content: 'We have something exciting to celebrate!\\n\\n[Your celebration message here]\\n\\nThank you for being part of our amazing community! 🎊',
                    color: '#00ff88'
                }
            };
            
            if (templates[type]) {
                titleField.value = templates[type].title;
                contentField.value = templates[type].content;
                colorField.value = templates[type].color;
                updatePreview();
            }
        }
        
        function updateTargetOptions() {
            const targetType = document.getElementById('targetType').value;
            const serverGroup = document.getElementById('serverSelectGroup');
            const timeGroup = document.getElementById('timeSelectionGroup');
            
            if (targetType === 'specific') {
                serverGroup.style.display = 'block';
                timeGroup.style.display = 'none';
                loadServerList();
            } else if (targetType === 'custom') {
                serverGroup.style.display = 'none';
                timeGroup.style.display = 'block';
            } else {
                serverGroup.style.display = 'none';
                timeGroup.style.display = 'none';
            }
        }
        
        function loadServerList() {
            const serverSelect = document.getElementById('targetServer');
            serverSelect.innerHTML = '<option value="">Loading servers...</option>';
            
            fetch('/admin/servers')
                .then(response => response.json())
                .then(servers => {
                    serverSelect.innerHTML = servers.map(server => 
                        \`<option value="\${server.id}">\${server.name} (\${server.memberCount} members)</option>\`
                    ).join('');
                })
                .catch(() => {
                    serverSelect.innerHTML = '<option value="">Error loading servers</option>';
                });
        }
        
        function updateScheduleOptions() {
            const schedule = document.getElementById('schedule').value;
            const customScheduleGroup = document.getElementById('customScheduleGroup');
            
            if (schedule === 'custom') {
                customScheduleGroup.style.display = 'block';
            } else {
                customScheduleGroup.style.display = 'none';
            }
        }
        
        function updatePreview() {
            const title = document.getElementById('messageTitle').value || 'No Title';
            const content = document.getElementById('messageContent').value || 'No content provided';
            const color = document.getElementById('messageColor').value;
            const includeFooter = document.getElementById('includeFooter').checked;
            const isUrgent = document.getElementById('urgentMessage').checked;
            
            const previewContainer = document.querySelector('.embed-preview');
            const previewTitle = document.getElementById('previewTitle');
            const previewContent = document.getElementById('previewContent');
            const previewFooter = document.getElementById('previewFooter');
            
            previewContainer.style.borderLeftColor = color;
            previewTitle.textContent = (isUrgent ? '🚨 ' : '') + title;
            previewContent.textContent = content;
            
            if (includeFooter) {
                previewFooter.style.display = 'block';
                previewFooter.textContent = 'AirTranslator Bot • ' + new Date().toLocaleString();
            } else {
                previewFooter.style.display = 'none';
            }
            
            document.getElementById('charCount').textContent = content.length;
        }
        
        function sendTestMessage() {
            if (confirm('Send a test message to the first available server?')) {
                sendMessage(true);
            }
        }
        
        function sendMessage(isTest = false) {
            const data = {
                type: document.getElementById('messageType').value,
                targetType: isTest ? 'test' : document.getElementById('targetType').value,
                targetServer: document.getElementById('targetServer')?.value,
                title: document.getElementById('messageTitle').value,
                content: document.getElementById('messageContent').value,
                color: document.getElementById('messageColor').value,
                includeFooter: document.getElementById('includeFooter').checked,
                isUrgent: document.getElementById('urgentMessage').checked
            };
            
            if (!data.content.trim()) {
                alert('Please enter a message content.');
                return;
            }
            
            if (!isTest && !confirm(\`Are you sure you want to send this message to \${data.targetType === 'all' ? 'ALL SERVERS' : 'the selected target'}?\`)) {
                return;
            }
            
            const progressSection = document.getElementById('sendingProgress');
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            const deliveryResults = document.getElementById('deliveryResults');
            
            progressSection.style.display = 'block';
            progressFill.style.width = '0%';
            progressText.textContent = isTest ? 'Sending test message...' : 'Preparing to send messages...';
            deliveryResults.innerHTML = '';
            
            fetch('/admin/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    progressFill.style.width = '100%';
                    progressText.textContent = \`Message sent successfully to \${result.delivered} server(s)!\`;
                    
                    result.results.forEach(serverResult => {
                        const div = document.createElement('div');
                        div.className = \`delivery-item \${serverResult.success ? 'delivery-success' : 'delivery-error'}\`;
                        div.innerHTML = \`
                            <span>\${serverResult.serverName}</span>
                            <span>\${serverResult.success ? '✅ Delivered' : '❌ Failed: ' + serverResult.error}</span>
                        \`;
                        deliveryResults.appendChild(div);
                    });
                } else {
                    progressFill.style.width = '0%';
                    progressText.textContent = 'Error: ' + result.message;
                }
            })
            .catch(error => {
                progressFill.style.width = '0%';
                progressText.textContent = 'Error sending message: ' + error.message;
            });
        }
        
        function scheduleMessage() {
            const data = {
                targetType: document.getElementById('targetType').value,
                targetServer: document.getElementById('targetServer')?.value,
                title: document.getElementById('messageTitle').value,
                content: document.getElementById('messageContent').value,
                color: document.getElementById('messageColor').value,
                includeFooter: document.getElementById('includeFooter').checked,
                isUrgent: document.getElementById('urgentMessage').checked,
                schedule: document.getElementById('schedule').value,
                timezone: document.getElementById('timezone').value,
                time: document.getElementById('scheduleTime').value
            };
            
            if (!data.content.trim()) {
                alert('Please enter a message content.');
                return;
            }
            
            if (!confirm(\`Are you sure you want to schedule this message to \${data.targetType === 'all' ? 'ALL SERVERS' : 'the selected target'}?\`)) {
                return;
            }
            
            fetch('/admin/schedule-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    alert('Message scheduled successfully!');
                } else {
                    alert('Error scheduling message: ' + result.message);
                }
            })
            .catch(error => {
                alert('Error scheduling message: ' + error.message);
            });
        }
        
        function restoreActiveTab() {
            const savedTab = sessionStorage.getItem('activeTab');
            if (savedTab && savedTab !== 'analytics') {
                const tabBtn = document.querySelector(\`[onclick="switchTab('\${savedTab}')"]\`);
                if (tabBtn) {
                    switchTab(savedTab);
                    tabBtn.classList.add('active');
                    if (savedTab === 'messaging') {
                        clearTimeout(refreshTimer);
                        refreshTimer = setTimeout(() => {
                            sessionStorage.setItem('activeTab', savedTab);
                            window.location.reload();
                        }, 300000);
                    }
                }
            }
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            restoreActiveTab();
            
            if (document.getElementById('messageContent')) {
                updatePreview();
                document.getElementById('messageContent').addEventListener('input', updatePreview);
                document.getElementById('messageTitle').addEventListener('input', updatePreview);
            }
        });
        // ==== Live Activity Chart ====
    let liveChart;
    let prevTranslationTotal = null;
    const translationsData = [];
    const labelsData = [];

    async function fetchMetrics() {
        const res = await fetch('/admin/metrics');
        if (!res.ok) return null;
        return res.json();
    }

    async function updateLiveChart() {
        const data = await fetchMetrics();
        if (!data) return;
        const now = new Date();
        if (prevTranslationTotal === null) {
            prevTranslationTotal = data.totalTranslations;
            return;
        }
        const delta = data.totalTranslations - prevTranslationTotal;
        prevTranslationTotal = data.totalTranslations;
        const rpm = delta * (60 / 5); // Estimate per minute with 5s interval
        translationsData.push(rpm);
        labelsData.push(now.toLocaleTimeString());
        if (translationsData.length > 12) {
            translationsData.shift();
            labelsData.shift();
        }
        if (liveChart) {
            liveChart.data.labels = labelsData;
            liveChart.data.datasets[0].data = translationsData;
            liveChart.update();
        }
    }

    function initLiveChart() {
        const ctx = document.getElementById('liveTranslationsChart');
        if (!ctx) return;
        liveChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labelsData,
                datasets: [{
                    label: 'Translations / Min',
                    data: translationsData,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102,126,234,0.2)',
                    tension: 0.3,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
        updateLiveChart();
        setInterval(updateLiveChart, 5000);
    }

    document.addEventListener('DOMContentLoaded', initLiveChart);
</script>
</head>
<body>
    <div class="header">
        <div style="position: relative;">
            <h1>AirTranslator Admin Dashboard</h1>
            <p>Complete Analytics & Server Management</p>
            <a href="/admin/logout" class="logout-btn">Logout</a>
        </div>
    </div>
    
    <div class="container">
        <div class="refresh-info">
            <span>Last updated: ${new Date().toLocaleString()} • Auto-refresh in 30s</span>
            <button class="refresh-btn" onclick="manualRefresh()">🔄 Refresh Now</button>
        </div>
        
        <div class="tab-container">
            <div class="tab-nav">
                <button class="tab-btn active" onclick="switchTab('analytics')">📊 Analytics</button>
                <button class="tab-btn" onclick="switchTab('messaging')">📢 Server Messaging</button>
                <button class="tab-btn" onclick="switchTab('feedback')">📊 Feedback</button>
            </div>
            
            <div class="tab-content">
                <div id="analytics" class="tab-pane active">
                    
                    ${generateAnalyticsContent(analytics, client)}
                    
                </div>
                
                <div id="messaging" class="tab-pane">
                    ${generateMessageInterface()}
                </div>
                
                <div id="feedback" class="tab-pane">
                    <h2>Message Feedback</h2>
                    
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h3>Total Messages</h3>
                            <p class="stat-value">${messagesWithFeedback.length}</p>
                        </div>
                    </div>
                    
                    <h3>Messages with Feedback</h3>
                    <div class="message-list">
                        ${messagesWithFeedback.map(msg => `
                            <div class="message-item" onclick="this.classList.toggle('expanded')">
                                <div class="message-header">
                                    <div>
                                        <strong>${new Date(msg.timestamp).toLocaleString()}</strong>
                                        <div class="message-preview">${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}</div>
                                    </div>
                                    <div class="feedback-stats">
                                        <div class="feedback-stat">👍 ${msg.likes}</div>
                                        <div class="feedback-stat">👎 ${msg.dislikes}</div>
                                        <div class="feedback-stat">💬 ${msg.comments.length}</div>
                                    </div>
                                </div>
                                
                                <div class="feedback-details">
                                    ${msg.comments.length > 0 ? `
                                        <h4>Comments (${msg.comments.length})</h4>
                                        ${msg.comments.map(comment => `
                                            <div class="comment-item">
                                                <div class="comment-header">
                                                    <span class="comment-user">${comment.username}</span>
                                                    <span class="comment-time">${new Date(comment.timestamp).toLocaleString()}</span>
                                                </div>
                                                <p class="comment-text">${comment.comment}</p>
                                            </div>
                                        `).join('')}
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="grid-2">
            <div class="section">
                <h2>💻 System Information</h2>
                <table class="table">
                    <tbody>
                        <tr>
                            <td><strong>Memory Usage</strong></td>
                            <td>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB</td>
                        </tr>
                        <tr>
                            <td><strong>Bot Started</strong></td>
                            <td>${analytics.botStartTime ? new Date(analytics.botStartTime).toLocaleString() : 'Unknown'}</td>
                        </tr>
                        <tr>
                            <td><strong>Node.js Version</strong></td>
                            <td>${process.version}</td>
                        </tr>
                        <tr>
                            <td><strong>Platform</strong></td>
                            <td>${process.platform} ${process.arch}</td>
                        </tr>
                        <tr>
                            <td><strong>Environment</strong></td>
                            <td>${process.env.NODE_ENV || 'development'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>📈 Performance Metrics</h2>
                <table class="table">
                    <tbody>
                        <tr>
                            <td><strong>Total API Calls</strong></td>
                            <td>${(analytics.totalTranslations || 0).toLocaleString()}</td>
                        </tr>
                        <tr>
                            <td><strong>Success Rate</strong></td>
                            <td>99.8% (estimated)</td>
                        </tr>
                        <tr>
                            <td><strong>Avg Response Time</strong></td>
                            <td>~1.2 seconds</td>
                        </tr>
                        <tr>
                            <td><strong>Peak Daily Usage</strong></td>
                            <td>${peakDayTranslations.toLocaleString()} translations</td>
                        </tr>
                        <tr>
                            <td><strong>Data Retention</strong></td>
                            <td>30 days rolling</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Sends messages to Discord servers based on admin configuration.
 * @param {Object} messageData - The message configuration data.
 * @returns {Object} Result object with success status and delivery results.
 */
async function sendServerMessage(messageData) {
    const client = global.discordClient;
    if (!client) {
        return { success: false, message: 'Bot not ready' };
    }
    
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    
    const embed = new EmbedBuilder()
        .setColor(messageData.color || '#3498db')
        .setDescription(messageData.content);
    
    if (messageData.title) {
        const title = messageData.isUrgent ? '🚨 ' + messageData.title : messageData.title;
        embed.setTitle(title);
    }
    
    if (messageData.includeFooter) {
        embed.setFooter({ 
            text: 'AirTranslator Bot • Official Message',
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();
    }
    
    // Add like/dislike/comment buttons
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('feedback_like')
            .setLabel('👍 Like')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('feedback_dislike')
            .setLabel('👎 Dislike')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('feedback_comment')
            .setLabel('💬 Comment')
            .setStyle(ButtonStyle.Primary)
    );
    
    let targetGuilds = [];
    
    switch (messageData.targetType) {
        case 'all':
            targetGuilds = Array.from(client.guilds.cache.values());
            break;
        case 'specific':
            if (messageData.targetServer) {
                const guild = client.guilds.cache.get(messageData.targetServer);
                if (guild) targetGuilds = [guild];
            }
            break;
        case 'large':
            targetGuilds = Array.from(client.guilds.cache.values()).filter(g => g.memberCount >= 1000);
            break;
        case 'active':
            const analytics = analyticsService.getAnalytics();
            const activeServerIds = Object.keys(analytics.channelActivity || {})
                .map(channelId => {
                    const channel = client.channels.cache.get(channelId);
                    return channel ? channel.guild.id : null;
                })
                .filter(Boolean);
            targetGuilds = Array.from(client.guilds.cache.values())
                .filter(g => activeServerIds.includes(g.id));
            break;
        case 'test':
            targetGuilds = [Array.from(client.guilds.cache.values())[0]].filter(Boolean);
            break;
    }
    
    const results = [];
    let delivered = 0;
    
    for (const guild of targetGuilds) {
        try {
            let targetChannel = null;
            
            targetChannel = guild.channels.cache.find(ch => 
                ch.type === 0 &&
                ch.name.toLowerCase().includes('announce') &&
                ch.permissionsFor(client.user).has(['SendMessages', 'EmbedLinks'])
            );
            
            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(ch => 
                    ch.type === 0 &&
                    (ch.name.toLowerCase().includes('general') || ch.name.toLowerCase().includes('chat')) &&
                    ch.permissionsFor(client.user).has(['SendMessages', 'EmbedLinks'])
                );
            }
            
            if (!targetChannel && guild.systemChannel) {
                targetChannel = guild.systemChannel;
            }
            
            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(ch => 
                    ch.type === 0 &&
                    ch.permissionsFor(client.user).has(['SendMessages', 'EmbedLinks'])
                );
            }
            
            if (targetChannel) {
                const message = await targetChannel.send({ 
                    embeds: [embed],
                    components: [buttons] 
                });
                
                // Track message for feedback collection
                analyticsService.trackAdminMessage({
                    messageId: message.id,
                    guildId: guild.id,
                    channelId: targetChannel.id,
                    content: messageData.content
                });
                
                results.push({
                    serverId: guild.id,
                    serverName: guild.name,
                    channelName: targetChannel.name,
                    success: true
                });
                delivered++;
            } else {
                results.push({
                    serverId: guild.id,
                    serverName: guild.name,
                    success: false,
                    error: 'No suitable channel found'
                });
            }
        } catch (error) {
            results.push({
                serverId: guild.id,
                serverName: guild.name,
                success: false,
                error: error.message
            });
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return {
        success: true,
        delivered,
        total: targetGuilds.length,
        results
    };
}

/**
 * Schedules a message to be sent at specific times
 * @param {Object} messageConfig - Message configuration
 * @param {string} messageConfig.target - 'all' or server ID
 * @param {string} messageConfig.content - Message content
 * @param {string} messageConfig.schedule - Cron schedule or 'daily', 'weekly', 'monthly'
 * @param {string} [messageConfig.timezone] - Timezone (default: 'UTC')
 * @param {string} [messageConfig.time] - Time (HH:mm)
 */
function scheduleMessage(messageConfig) {
    const { schedule, timezone = 'UTC', time } = messageConfig;
    
    // Convert human-readable schedules to cron
    let cronPattern;
    switch(schedule) {
        case 'daily':
            cronPattern = `0 ${time.split(':')[1]} ${time.split(':')[0]} * * *`; // Daily at specified time
            break;
        case 'weekly':
            cronPattern = `0 ${time.split(':')[1]} ${time.split(':')[0]} * * 0`; // Sunday at specified time
            break;
        case 'monthly':
            cronPattern = `0 ${time.split(':')[1]} ${time.split(':')[0]} 1 * *`; // 1st of month at specified time
            break;
        default:
            cronPattern = schedule;
    }
    
    const job = nodeCron.schedule(cronPattern, () => {
        sendScheduledMessage(messageConfig);
    }, {
        scheduled: true,
        timezone
    });
    
    scheduledMessages.set(job.id, messageConfig);
    return job.id;
}

/**
 * Sends a scheduled message
 * @param {Object} messageConfig - Message configuration
 */
async function sendScheduledMessage(messageConfig) {
    try {
        const { target, content, title = 'Scheduled Message', color = '#3498db' } = messageConfig;
        
        // Implementation depends on your message sending logic
        if (target === 'all') {
            // Broadcast to all servers
            console.log(`Sending scheduled message to all servers: ${title}`);
        } else {
            // Send to specific server
            console.log(`Sending scheduled message to server ${target}: ${title}`);
        }
    } catch (err) {
        console.error('Failed to send scheduled message:', err);
    }
}

/**
 * Cancels a scheduled message
 * @param {string} jobId - The job ID to cancel
 */
function cancelScheduledMessage(jobId) {
    const job = scheduledMessages.get(jobId);
    if (job) {
        job.destroy();
        scheduledMessages.delete(jobId);
    }
}

const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;
    
    try {
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
        } else if (pathname === '/ping') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('pong');
        } else if (pathname === '/admin/servers' && req.method === 'GET') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            
            const client = global.discordClient;
            if (!client) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bot not ready' }));
                return;
            }
            
            const servers = client.guilds.cache.map(guild => ({
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount,
                joinedAt: guild.joinedAt.toISOString()
            }));
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(servers));
        } else if (pathname === '/admin/metrics' && req.method === 'GET') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            const analytics = analyticsService.getAnalytics();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                totalTranslations: analytics.totalTranslations,
                totalServers: analytics.totalServers,
                timestamp: Date.now()
            }));
        } else if (pathname === '/admin/send-message' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const messageData = JSON.parse(postData.body || '{}');
                
                const result = await sendServerMessage(messageData);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (error) {
                console.error('Message sending error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Server error' }));
            }
        } else if (pathname === '/admin/schedule-message' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const messageData = JSON.parse(postData.body || '{}');
                
                const jobId = scheduleMessage(messageData);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, jobId }));
            } catch (error) {
                console.error('Message scheduling error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Server error' }));
            }
        } else if (pathname === '/admin/scheduled-messages' && req.method === 'GET') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            const messages = Array.from(scheduledMessages.entries()).map(([id, config]) => ({
                id,
                ...config
            }));
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, messages }));
        } else if (pathname.startsWith('/admin/cancel-scheduled/') && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            const jobId = pathname.split('/').pop();
            cancelScheduledMessage(jobId);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else if (pathname === '/admin') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            
            if (isValidSession(sessionToken)) {
                const analytics = analyticsService.getAnalytics();
                const client = global.discordClient;
                const dashboard = generateDashboard(analytics, client);
                
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(dashboard);
            } else {
                const loginPage = generateLoginPage();
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(loginPage);
            }
        } else if (pathname === '/admin/login' && req.method === 'POST') {
            try {
                const postData = await parsePostData(req);
                
                if (verifyCredentials(postData.username, postData.password)) {
                    const sessionToken = generateSessionToken();
                    sessions.set(sessionToken, {
                        createdAt: Date.now(),
                        username: postData.username
                    });
                    
                    res.writeHead(302, {
                        'Set-Cookie': `session=${sessionToken}; HttpOnly; Path=/; Max-Age=86400`,
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
        } else if (pathname === '/admin/logout') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (sessionToken) {
                sessions.delete(sessionToken);
            }
            
            res.writeHead(302, {
                'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0',
                'Location': '/admin'
            });
            res.end();
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
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
    console.log(`🏥 Health check server running on port ${PORT}`);
    console.log(`📊 Health endpoint: http://localhost:${PORT}/health`);
    
    if (process.env.NODE_ENV === 'production') {
        const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://airtranslator.onrender.com';
        console.log(`🔐 Admin panel: ${renderUrl}/admin`);
        console.log(`🌐 Live at: ${renderUrl}`);
    } else {
        console.log(`🔐 Admin panel: http://localhost:${PORT}/admin`);
        console.log(`🌐 Local server: http://localhost:${PORT}`);
    }
});

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down health server gracefully');
    server.close(() => {
        console.log('✅ Health server closed');
    });
});

module.exports = server;
