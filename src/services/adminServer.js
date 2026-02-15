const http = require('http');
const crypto = require('crypto');
const analyticsService = require('./analyticsService');
const monetizationService = require('./monetizationService');
const databaseService = require('./databaseService');
const nodeCron = require('node-cron');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AirTranslator2024!';


/**
 * Session management
 * Stores active sessions in memory with a 24-hour expiration.
 */
const sessions = new Map();

// Scheduled messages storage
const scheduledMessages = new Map(); // job metadata only (JSON-safe)
const scheduledJobs = new Map(); // jobId -> cron job handle

// In-memory caps and intervals
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SESSION_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10m
const MAX_SESSIONS = 5000;
const MAX_SCHEDULED_MESSAGES = 1000;

// Analytics cache (HTML) with short TTL
const ANALYTICS_CACHE_TTL_MS = 60 * 1000; // 60s
let dashboardCache = { html: null, ts: 0 };

// Periodic sweepers to control memory
function sweepSessions() {
    const now = Date.now();
    for (const [token, sess] of sessions.entries()) {
        if (!sess || (now - (sess.createdAt || 0)) > SESSION_TTL_MS) {
            sessions.delete(token);
        }
    }
    // Cap size: evict oldest entries if over limit
    while (sessions.size > MAX_SESSIONS) {
        const oldestKey = sessions.keys().next().value;
        sessions.delete(oldestKey);
    }
}

function sweepScheduledMessages() {
    // Cap size only; scheduled jobs are recurring, so we don't TTL them aggressively
    while (scheduledMessages.size > MAX_SCHEDULED_MESSAGES) {
        const oldestKey = scheduledMessages.keys().next().value;
        // try to stop underlying job if still present
        const job = scheduledJobs.get(oldestKey);
        if (job && typeof job.destroy === 'function') {
            try { job.destroy(); } catch (_) {}
        }
        scheduledJobs.delete(oldestKey);
        scheduledMessages.delete(oldestKey);
    }
}

setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS).unref();
setInterval(sweepScheduledMessages, SESSION_SWEEP_INTERVAL_MS).unref();

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
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AirTranslator • Admin Login</title>
  <style>
    :root {
      --bg: #f8fafc;
      --bg-soft: #f1f5f9;
      --card: #ffffff;
      --text: #1e293b;
      --muted: #64748b;
      --primary: #8b5cf6;
      --primary-hover: #7c3aed;
      --primary-light: #f5f3ff;
      --danger: #ef4444;
      --success: #10b981;
      --input: #f8fafc;
      --border: #e2e8f0;
      --ring: 0 0 0 3px rgba(139, 92, 246, .15);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { height: 100%; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      background-attachment: fixed;
      color: var(--text); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      min-height: 100vh;
      padding: 16px;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px);
      background-size: 50px 50px;
      animation: drift 60s linear infinite;
    }
    @keyframes drift {
      from { transform: translate(0, 0); }
      to { transform: translate(50px, 50px); }
    }

    .card {
      width: 100%; 
      max-width: 420px; 
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.3); 
      border-radius: 20px; 
      padding: 32px 36px; 
      position: relative;
      z-index: 1;
      box-shadow: 0 20px 60px rgba(0,0,0,.2), 0 0 0 1px rgba(255,255,255,.5) inset;
      transition: transform 0.3s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 25px 70px rgba(0,0,0,.23), 0 0 0 1px rgba(255,255,255,.5) inset;
    }

    .brand { text-align: center; margin-bottom: 24px; }
    .logo { 
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 52px; 
      height: 52px; 
      border-radius: 16px; 
      background: linear-gradient(135deg, #667eea, #764ba2); 
      box-shadow: 0 8px 24px rgba(118,75,162,.35);
      font-size: 26px;
      margin-bottom: 12px;
    }
    .title { 
      font-weight: 700; 
      font-size: 24px; 
      letter-spacing: -0.5px;
      color: var(--text);
      margin-bottom: 6px;
    }
    .subtitle { 
      color: var(--muted); 
      font-size: 14px;
      line-height: 1.4;
    }

    .error { 
      background: #fee2e2; 
      color: #991b1b; 
      border: 1px solid #fca5a5; 
      padding: 12px 16px; 
      border-radius: 12px; 
      margin: 0 0 24px;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .error::before {
      content: '⚠️';
      font-size: 18px;
    }

    .field { margin-bottom: 16px; }
    .label { 
      display: block;
      color: var(--text); 
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .input-wrap { position: relative; }
    .input {
      width: 100%; 
      padding: 12px 14px;
      background: var(--input); 
      color: var(--text);
      border: 2px solid var(--border);
      border-radius: 10px; 
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: all 0.2s ease;
    }
    .input:hover { border-color: #cbd5e1; }
    .input:focus { 
      box-shadow: var(--ring); 
      border-color: var(--primary);
      background: #ffffff;
    }
    .icon-btn { 
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent; 
      border: 0; 
      color: var(--muted);
      cursor: pointer; 
      padding: 8px;
      border-radius: 8px;
      transition: color 0.2s ease;
    }
    .icon-btn:hover { color: var(--text); }
    .icon-btn:focus-visible { outline: none; box-shadow: var(--ring); }

    .row { 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      margin: -6px 0 18px;
    }
    .remember-label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      user-select: none;
    }
    .remember-label input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .actions { margin-top: 6px; }
    .btn-primary {
      width: 100%;
      appearance: none; 
      border: 0;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; 
      padding: 13px;
      border-radius: 10px; 
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .btn-primary:hover { 
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
    }
    .btn-primary:active { 
      transform: translateY(0);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .footer { 
      margin-top: 24px; 
      padding-top: 20px;
      border-top: 1px solid var(--border);
      color: var(--muted); 
      font-size: 12px;
      text-align: center;
    }



    @media (max-width: 480px) { 
      body { padding: 12px; }
      .card { 
        padding: 24px 20px;
        border-radius: 16px;
      }
      .brand { margin-bottom: 18px; }
      .title { font-size: 22px; }
      .logo { width: 48px; height: 48px; font-size: 24px; margin-bottom: 10px; }
      .field { margin-bottom: 14px; }
      .footer { margin-top: 20px; padding-top: 16px; }
    }
  </style>
</head>
<body>
  <main class="card" id="card">
    <div class="brand">
      <div class="logo">🤖</div>
      <h1 class="title">Welcome Back</h1>
      <p class="subtitle">Sign in to access the AirTranslator admin dashboard</p>
    </div>

    ${error ? `<div class="error">${error}</div>` : ''}

    <form method="POST" action="/admin/login" id="loginForm" novalidate>
      <div class="field">
        <label class="label" for="username">Username</label>
        <input class="input" type="text" id="username" name="username" autocomplete="username" placeholder="Enter your username" required />
      </div>

      <div class="field">
        <label class="label" for="password">Password</label>
        <div class="input-wrap">
          <input class="input" type="password" id="password" name="password" autocomplete="current-password" placeholder="Enter your password" required style="padding-right: 48px;" />
          <button class="icon-btn" type="button" id="togglePwd" aria-label="Show password">👁️</button>
        </div>
      </div>

      <div class="row">
        <label class="remember-label">
          <input type="checkbox" id="rememberMe" />
          <span>Remember me</span>
        </label>
      </div>

      <div class="actions">
        <button type="submit" class="btn-primary" id="submitBtn">Sign In</button>
      </div>
    </form>

    <p class="footer">🔒 Secure Admin Access • AirTranslator</p>
  </main>

  <script>
    // Check if already logged in
    (async function checkAuth() {
      try {
        const response = await fetch('/admin', { method: 'GET', credentials: 'include' });
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const html = await response.text();
          if (!html.includes('loginForm')) {
            window.location.href = '/admin';
            return;
          }
        }
      } catch (e) {
        // Not logged in, continue with login page
      }
    })();
    
    (function() {
      const form = document.getElementById('loginForm');
      const username = document.getElementById('username');
      const password = document.getElementById('password');
      const submitBtn = document.getElementById('submitBtn');
      const togglePwd = document.getElementById('togglePwd');
      const remember = document.getElementById('rememberMe');

      // Prefill username if remembered
      const savedUser = localStorage.getItem('at_admin_user');
      if (savedUser) {
        username.value = savedUser;
        remember.checked = true;
      }

      // Password visibility
      togglePwd.addEventListener('click', () => {
        const isPwd = password.type === 'password';
        password.type = isPwd ? 'text' : 'password';
        togglePwd.textContent = isPwd ? '🙈' : '👁️';
      });

      // Form submission
      form.addEventListener('submit', (e) => {
        if (!username.value.trim() || !password.value) {
          e.preventDefault();
          alert('Please enter both username and password.');
          return;
        }
        if (remember.checked) {
          localStorage.setItem('at_admin_user', username.value.trim());
        } else {
          localStorage.removeItem('at_admin_user');
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';
      });
    })();
  </script>
</body>
</html>`;
}

/**
 * Generates the HTML for the server messaging interface.
 * @returns {string} The HTML content for the messaging interface.
 */
function generateMessageInterface() {
    return `
    <div class="messaging-container">
      <style>
        .messaging-container { color: #1f2937; }
        .messaging-container .head {
          display:flex; align-items:center; justify-content: space-between; gap:12px; margin-bottom:16px;
        }
        .messaging-container .title {
          display:flex; align-items:center; gap:10px; font-weight:700; font-size:20px;
        }
        .messaging-container .subtitle { color:#6b7280; font-size:13px; margin-top:4px; }
        .messaging-container .chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 8px; border-radius:999px; background:#eef2ff; color:#4f46e5; border:1px solid #e0e7ff; }
        .messaging-container .grid { display:grid; grid-template-columns: 1.3fr .9fr; gap:20px; }
        .messaging-container .card { background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; box-shadow: 0 8px 20px rgba(0,0,0,.04); }
        .messaging-container .card .card-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f3f4f6; }
        .messaging-container .card .card-body { padding:16px; }
        .messaging-container .row { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
        .messaging-container .field { margin-bottom:12px; }
        .messaging-container .label { display:flex; align-items:center; justify-content:space-between; color:#374151; font-size:12px; font-weight:600; margin-bottom:6px; }
        .messaging-container .hint { color:#6b7280; font-size:12px; }
        .messaging-container select, .messaging-container input[type="text"], .messaging-container textarea, .messaging-container input[type="time"] {
          width:100%; background:#f9fafb; border:1.5px solid #e5e7eb; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; transition:border-color .2s, box-shadow .2s; color:#111827;
        }
        .messaging-container select:focus, .messaging-container input[type="text"]:focus, .messaging-container textarea:focus, .messaging-container input[type="time"]:focus {
          border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.18);
        }
        .messaging-container .chips { display:flex; gap:8px; flex-wrap:wrap; }
        .messaging-container .badge { display:inline-flex; align-items:center; padding:4px 8px; border-radius:8px; font-size:12px; border:1px solid #e5e7eb; color:#374151; background:#f9fafb; }
        .messaging-container .badge.success { color:#065f46; background:#ecfdf5; border-color:#a7f3d0; }
        .messaging-container .badge.warn { color:#92400e; background:#fffbeb; border-color:#fde68a; }
        .messaging-container .badge.info { color:#1e40af; background:#eff6ff; border-color:#bfdbfe; }
        .messaging-container .controls { display:flex; gap:10px; flex-wrap:wrap; }
        .messaging-container .controls .btn { appearance:none; border:0; border-radius:10px; padding:12px 16px; font-weight:700; cursor:pointer; transition:filter .15s, transform .04s; display:inline-flex; align-items:center; gap:8px; }
        .messaging-container .controls .btn.primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }
        .messaging-container .controls .btn.ghost { background:#fff; color:#374151; border:1px solid #e5e7eb; }
        .messaging-container .controls .btn.warn { background:#f59e0b; color:#111827; }
        .messaging-container .controls .btn.test { background:#10b981; color:#fff; }
        .messaging-container .controls .btn:hover { filter:brightness(1.04); }
        .messaging-container .controls .btn:active { transform: translateY(1px); }
        .messaging-container .embed { border-left:5px solid #6366f1; background:#f9fafb; border-radius:10px; padding:14px; }
        .messaging-container .embed .e-title { font-weight:800; font-size:16px; color:#111827; margin-bottom:6px; }
        .messaging-container .embed .e-desc { color:#4b5563; white-space:pre-wrap; line-height:1.5; margin-bottom:10px; }
        .messaging-container .embed .e-foot { color:#6b7280; font-size:12px; border-top:1px dashed #e5e7eb; padding-top:8px; }
        .messaging-container .meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .messaging-container .progress { background:#f3f4f6; height:10px; border-radius:999px; overflow:hidden; }
        .messaging-container .progress .bar { height:100%; width:0%; background:linear-gradient(90deg,#6366f1,#10b981); transition: width .3s ease; }
        @media (max-width: 980px) { .messaging-container .grid { grid-template-columns: 1fr; } }
      </style>

      <div class="head">
        <div>
          <div class="title">📢 Server Messaging</div>
          <div class="subtitle">Compose, preview, and dispatch announcements to your servers with confidence.</div>
        </div>
        <span class="chip">Secure • Admin Only</span>
      </div>

      <div class="grid">
        <div class="left">
          <div class="card">
            <div class="card-head">
              <div class="title">✍️ Compose</div>
              <div class="chips">
                <span class="badge info">Draft</span>
                <span class="badge warn">Max 1500 chars</span>
              </div>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="field">
                  <label class="label" for="messageType">Message Type <span class="hint">templates</span></label>
                  <select id="messageType" onchange="updateMessageTemplate()">
                    <option value="custom">Custom Message</option>
                    <option value="announcement">📢 Announcement</option>
                    <option value="update">🔄 Bot Update</option>
                    <option value="maintenance">🔧 Maintenance</option>
                    <option value="feature">✨ New Feature</option>
                    <option value="warning">⚠️ Important</option>
                    <option value="celebration">🎉 Celebration</option>
                  </select>
                </div>
                <div class="field">
                  <label class="label" for="messageColor">Embed Color <span class="hint">visual accent</span></label>
                  <select id="messageColor">
                    <option value="#3498db">Blue (Info)</option>
                    <option value="#00ff88">Green (Success)</option>
                    <option value="#ffa500">Orange (Warning)</option>
                    <option value="#ff6b6b">Red (Important)</option>
                    <option value="#9b59b6">Purple (Feature)</option>
                    <option value="#f39c12">Yellow (Announcement)</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="label" for="messageTitle">Title <span class="hint">optional</span></label>
                <input type="text" id="messageTitle" placeholder="e.g., Important Bot Update" maxlength="100" />
              </div>
              <div class="field">
                <label class="label" for="messageContent">Content</label>
                <textarea id="messageContent" rows="6" placeholder="Type your message here..." maxlength="1500"></textarea>
                <div class="hint" style="text-align:right"><span id="charCount">0</span> / 1500</div>
              </div>
              <div class="row">
                <div class="field">
                  <label class="label" for="targetType">Send To</label>
                  <select id="targetType" onchange="updateTargetOptions()">
                    <option value="all">All Servers (Broadcast)</option>
                    <option value="specific">Specific Server</option>
                    <option value="large">Large Servers Only (1000+ members)</option>
                    <option value="active">Active Servers Only (recent activity)</option>
                  </select>
                </div>
                <div class="field" id="serverSelectGroup" style="display:none;">
                  <label class="label" for="targetServer">Select Server</label>
                  <select id="targetServer"></select>
                </div>
              </div>
              <div class="row">
                <div class="field">
                  <label class="label" for="schedule">Schedule</label>
                  <select id="schedule" onchange="updateScheduleOptions()">
                    <option value="now">Send Now</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="custom">Custom Cron</option>
                  </select>
                </div>
                <div class="field" id="timeSelectionGroup">
                  <label class="label" for="scheduleTime">Time</label>
                  <input type="time" id="scheduleTime" value="12:00" required />
                </div>
              </div>
              <div class="row">
                <div class="field" id="customScheduleGroup" style="display:none;">
                  <label class="label" for="customSchedule">Custom Cron</label>
                  <input type="text" id="customSchedule" placeholder="* * * * *" />
                  <div class="hint">Cron: min hour day month day-of-week</div>
                </div>
                <div class="field">
                  <label class="label" for="timezone">Timezone</label>
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
              <div class="chips" style="margin-top:6px;">
                <label class="badge"><input type="checkbox" id="includeFooter" checked style="margin-right:6px;">Include footer & timestamp</label>
                <label class="badge warn"><input type="checkbox" id="urgentMessage" style="margin-right:6px;">Mark as urgent</label>
              </div>
            </div>
          </div>

          <div class="card" id="sendingProgress" style="display:none;">
            <div class="card-head">
              <div class="title">📡 Sending</div>
              <span class="badge info">Live</span>
            </div>
            <div class="card-body">
              <div class="progress"><div id="progressFill" class="bar"></div></div>
              <div id="progressText" class="hint" style="margin-top:8px;">Preparing to send…</div>
              <div id="deliveryResults" style="margin-top:12px;"></div>
            </div>
          </div>
        </div>

        <div class="right">
          <div class="card">
            <div class="card-head">
              <div class="title">📝 Preview</div>
              <span class="badge">Real-time</span>
            </div>
            <div class="card-body">
              <div class="meta" style="margin-bottom:8px;">
                <span class="badge info" id="targetBadge">Target</span>
                <span class="badge" id="scheduleBadge">Schedule</span>
              </div>
              <div class="embed embed-preview">
                <div id="previewTitle" class="e-title">Title will appear here</div>
                <div id="previewContent" class="e-desc">Message content will appear here</div>
                <div id="previewFooter" class="e-foot">AirTranslator Bot • Now</div>
              </div>
              <div class="controls" style="margin-top:14px;">
                <button type="button" class="btn ghost" onclick="updatePreview()">🔄 Update Preview</button>
                <button type="button" class="btn test" onclick="sendTestMessage()">🧪 Send Test</button>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:20px;">
            <div class="card-head">
              <div class="title">🚀 Actions</div>
              <span class="badge success">Ready</span>
            </div>
            <div class="card-body">
              <div class="controls">
                <button type="button" class="btn primary" onclick="sendMessage()">📤 Send Message</button>
                <button type="button" class="btn warn" onclick="scheduleMessage()">🕒 Schedule</button>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:20px;">
            <div class="card-head">
              <div class="title">🧭 Auto Setup Outreach</div>
              <span class="badge info">Existing Servers</span>
            </div>
            <div class="card-body">
              <div class="field">
                <label class="label" for="autoSetupServerSelect">Target Server</label>
                <select id="autoSetupServerSelect">
                  <option value="">Loading servers...</option>
                </select>
              </div>
              <div class="controls">
                <button type="button" class="btn primary" id="autoSetupSendBtn" onclick="sendAutoSetupMessage()">🚀 Send Auto Setup Packet</button>
                <button type="button" class="btn warn" id="autoSetupSendAllBtn" onclick="sendAutoSetupMessage(true)">🌐 Send to All Servers</button>
                <button type="button" class="btn ghost" onclick="loadAutoSetupServers()">🔄 Refresh List</button>
              </div>
              <div class="hint" id="autoSetupStatus" style="margin-top:10px;">Send the guided Auto Setup flow to selected or all servers.</div>
            </div>
          </div>
        </div>
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
    const peakDayTranslations = Object.values(analytics.dailyStats || {})
        .reduce((max, day) => Math.max(max, day.translations || 0), 0);

    const topServers = (analytics.serverList || [])
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 10);

    const channelStats = Object.entries(analytics.channelActivity || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    // Prepare data for charts
    const chartLabels = recentDays.map(([date]) => new Date(date).toLocaleDateString());
    const chartData = recentDays.map(([_, stats]) => (stats.translations || 0));

    return `
    <div class="analytics-container">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-icon soft indigo">🏠</div>
          <div class="kpi-content">
            <div class="kpi-title">Active Servers</div>
            <div class="kpi-value">${analytics.totalServers || 0}</div>
            <div class="kpi-sub">Channels: ${totalChannels.toLocaleString()}</div>
          </div>
          <span class="badge neutral">Live</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon soft green">👥</div>
          <div class="kpi-content">
            <div class="kpi-title">Total Reach</div>
            <div class="kpi-value">${totalMembers.toLocaleString()}</div>
            <div class="kpi-sub">Avg/server: ${analytics.totalServers > 0 ? Math.round(totalMembers / analytics.totalServers) : 0}</div>
          </div>
          <span class="badge success">↑</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon soft pink">🔄</div>
          <div class="kpi-content">
            <div class="kpi-title">Total Translations</div>
            <div class="kpi-value">${(analytics.totalTranslations || 0).toLocaleString()}</div>
            <div class="kpi-sub">Daily avg: ${avgTranslationsPerDay} • Peak: ${peakDayTranslations}</div>
          </div>
          <span class="badge accent">24h</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon soft orange">⏱️</div>
          <div class="kpi-content">
            <div class="kpi-title">System Uptime</div>
            <div class="kpi-value">${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</div>
            <div class="kpi-sub">Mem: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</div>
          </div>
          <span class="badge warn">OK</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon soft blue">📡</div>
          <div class="kpi-content">
            <div class="kpi-title">Active Channels</div>
            <div class="kpi-value">${activeChannels}</div>
            <div class="kpi-sub">Coverage: ${totalChannels > 0 ? Math.round((activeChannels / totalChannels) * 100) : 0}%</div>
          </div>
          <span class="badge info">Net</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon soft purple">🌍</div>
          <div class="kpi-content">
            <div class="kpi-title">Language Pairs</div>
            <div class="kpi-value">${Object.keys(analytics.languageUsage || {}).length}</div>
            <div class="kpi-sub">Top: ${topLanguages[0] ? topLanguages[0][0] : '—'}</div>
          </div>
          <span class="badge neutral">Mix</span>
        </div>
      </div>

      <div class="grid-2">
        <div class="card chart-card">
          <div class="card-head">
            <div class="title">📅 Translations - Last 14 Days</div>
            <span class="chip">Trend</span>
          </div>
          <div class="chart-wrap"><canvas id="translationsTrendChart"></canvas></div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="title">🏆 Top Servers by Size</div>
            <span class="chip info">Top 10</span>
          </div>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Server</th>
                <th>Members</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              ${topServers.map(server => `
                <tr>
                  <td><span class="label-strong">${server.name}</span></td>
                  <td>${server.memberCount.toLocaleString()}</td>
                  <td><span class="pill">${new Date(server.joinedAt).toLocaleDateString()}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <div class="title">🌍 Language Usage</div>
            <span class="chip accent">Top 10</span>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Language Pair</th>
                <th class="right">Count</th>
                <th class="right">%</th>
              </tr>
            </thead>
            <tbody>
              ${topLanguages.map(([pair, count]) => {
                const percentage = analytics.totalTranslations > 0 ? Math.round((count / analytics.totalTranslations) * 100) : 0;
                return `
                <tr>
                  <td>${pair}</td>
                  <td class="right">${count.toLocaleString()}</td>
                  <td class="right"><span class="badge soft">${percentage}%</span>
                    <div class="meter"><span style="width:${percentage}%"></span></div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="title">⚡ Command Performance</div>
            <span class="chip success">Usage</span>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Command</th>
                <th class="right">Count</th>
                <th class="right">%</th>
              </tr>
            </thead>
            <tbody>
              ${topCommands.map(([command, count]) => {
                const totalCommands = Object.values(analytics.commandUsage || {}).reduce((sum, c) => sum + c, 0);
                const percentage = totalCommands > 0 ? Math.round((count / totalCommands) * 100) : 0;
                return `
                <tr>
                  <td>/${command}</td>
                  <td class="right">${count.toLocaleString()}</td>
                  <td class="right"><span class="badge success">${percentage}%</span>
                    <div class="meter green"><span style="width:${percentage}%"></span></div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="title">📊 Channel Activity</div>
          <span class="chip neutral">Heat</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th class="right">Translations</th>
              <th class="right">Activity</th>
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
                <td class="right">${count.toLocaleString()}</td>
                <td class="right">
                  <span class="badge info">${percentage}%</span>
                  <div class="meter blue"><span style="width:${percentage}%"></span></div>
                </td>
                <td>${serverName}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head"><div class="title">💻 System Information</div></div>
          <ul class="kv">
            <li><span>Memory Usage</span><b>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB</b></li>
            <li><span>Bot Started</span><b>${analytics.botStartTime ? new Date(analytics.botStartTime).toLocaleString() : 'Unknown'}</b></li>
            <li><span>Node.js Version</span><b>${process.version}</b></li>
            <li><span>Platform</span><b>${process.platform} ${process.arch}</b></li>
            <li><span>Environment</span><b>${process.env.NODE_ENV || 'development'}</b></li>
          </ul>
        </div>
        <div class="card">
          <div class="card-head"><div class="title">📈 Performance Metrics</div></div>
          <ul class="kv">
            <li><span>Total API Calls</span><b>${(analytics.totalTranslations || 0).toLocaleString()}</b></li>
            <li><span>Success Rate</span><b>99.8% <span class="dot success"></span></b></li>
            <li><span>Avg Response</span><b>~1.2s</b></li>
            <li><span>Peak Daily</span><b>${peakDayTranslations.toLocaleString()}</b></li>
            <li><span>Retention</span><b>30 days rolling</b></li>
          </ul>
        </div>
      </div>

      <style>
        .analytics-container { --bg:#fff; --text:#1f2937; --muted:#6b7280; --ring:#e5e7eb; --indigo:#667eea; --accent:#764ba2; --green:#10b981; --orange:#f59e0b; --pink:#ec4899; --blue:#3b82f6; --purple:#8b5cf6; }
        .analytics-container { display:block; }
        .analytics-container .kpi-grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin-bottom:20px; }
        .analytics-container .kpi-card { position:relative; display:flex; gap:14px; align-items:center; background:var(--bg); border:1px solid var(--ring); border-radius:12px; padding:16px; box-shadow:0 6px 20px rgba(0,0,0,0.06); transition:transform .2s ease, box-shadow .2s ease; }
        .analytics-container .kpi-card:hover { transform: translateY(-2px); box-shadow:0 12px 28px rgba(0,0,0,0.08); }
        .analytics-container .kpi-icon { width:44px; height:44px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:22px; }
        .analytics-container .kpi-icon.soft { background: #f3f4f6; }
        .analytics-container .kpi-icon.indigo { color: var(--indigo); }
        .analytics-container .kpi-icon.green { color: var(--green); }
        .analytics-container .kpi-icon.orange { color: var(--orange); }
        .analytics-container .kpi-icon.pink { color: var(--pink); }
        .analytics-container .kpi-icon.blue { color: var(--blue); }
        .analytics-container .kpi-icon.purple { color: var(--purple); }
        .analytics-container .kpi-title { color: var(--muted); font-size:12px; font-weight:600; letter-spacing:.02em; text-transform: uppercase; }
        .analytics-container .kpi-value { color: var(--text); font-size:26px; font-weight:800; line-height:1.1; }
        .analytics-container .kpi-sub { color: var(--muted); font-size:12px; }
        .analytics-container .badge { position:absolute; top:10px; right:10px; font-size:11px; padding:4px 8px; border-radius:999px; border:1px solid var(--ring); background:#f9fafb; color:#111827; }
        .analytics-container .badge.success { background: #ecfdf5; color:#065f46; border-color:#a7f3d0; }
        .analytics-container .badge.warn { background:#fff7ed; color:#9a3412; border-color:#fed7aa; }
        .analytics-container .badge.info { background:#eff6ff; color:#1e40af; border-color:#bfdbfe; }
        .analytics-container .badge.accent { background:#f5f3ff; color:#4c1d95; border-color:#ddd6fe; }
        .analytics-container .badge.neutral { background:#f3f4f6; color:#374151; border-color:#e5e7eb; }

        .analytics-container .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
        .analytics-container .card { background:var(--bg); border:1px solid var(--ring); border-radius:12px; padding:16px; box-shadow:0 6px 20px rgba(0,0,0,0.06); }
        .analytics-container .card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .analytics-container .card .title { font-weight:700; color:var(--text); letter-spacing:.2px; }
        .analytics-container .chip { font-size:11px; padding:4px 10px; border-radius:999px; background:#f8fafc; border:1px solid var(--ring); color:#334155; }
        .analytics-container .chip.info { background:#eff6ff; color:#1e40af; border-color:#bfdbfe; }
        .analytics-container .chip.success { background:#ecfdf5; color:#065f46; border-color:#a7f3d0; }
        .analytics-container .chip.accent { background:#f5f3ff; color:#4c1d95; border-color:#ddd6fe; }
        .analytics-container .chip.neutral { background:#f3f4f6; color:#374151; border-color:#e5e7eb; }

        .analytics-container .chart-card .chart-wrap { position:relative; height:280px; }
        .analytics-container .data-table { width:100%; border-collapse:separate; border-spacing:0 8px; }
        .analytics-container .data-table thead th { font-size:12px; text-transform:uppercase; letter-spacing:.02em; color:var(--muted); text-align:left; padding:8px 10px; }
        .analytics-container .data-table td { background:#fff; border:1px solid var(--ring); border-left:none; border-right:none; padding:10px; }
        .analytics-container .data-table tr { transition: transform .15s ease, box-shadow .15s ease; }
        .analytics-container .data-table tbody tr:hover td { box-shadow: 0 4px 16px rgba(0,0,0,0.06); transform: translateY(-1px); }
        .analytics-container .data-table.compact td { padding:8px 10px; }
        .analytics-container .data-table .right { text-align:right; }
        .analytics-container .label-strong { font-weight:600; color:var(--text); }
        .analytics-container .pill { background:#f3f4f6; color:#374151; padding:4px 10px; border-radius:999px; font-size:12px; border:1px solid var(--ring); }

        .analytics-container .meter { height:6px; background:#f3f4f6; border-radius:999px; overflow:hidden; margin-top:6px; }
        .analytics-container .meter > span { display:block; height:100%; background:linear-gradient(90deg, var(--indigo), var(--accent)); border-radius:999px; transition:width .4s ease; }
        .analytics-container .meter.green > span { background:linear-gradient(90deg, #10b981, #34d399); }
        .analytics-container .meter.blue > span { background:linear-gradient(90deg, #3b82f6, #60a5fa); }

        .analytics-container .kv { list-style:none; padding:0; margin:0; }
        .analytics-container .kv li { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px dashed var(--ring); }
        .analytics-container .kv li:last-child { border-bottom:none; }
        .analytics-container .kv li span { color:var(--muted); }
        .analytics-container .kv li b { color:var(--text); font-weight:700; }
        .analytics-container .dot { display:inline-block; width:8px; height:8px; border-radius:999px; margin-left:6px; vertical-align:middle; background:#10b981; }
        .analytics-container .dot.success { background:#10b981; }

        @media (max-width: 900px) { .analytics-container .grid-2 { grid-template-columns: 1fr; } .analytics-container .chart-card .chart-wrap { height:220px; } }
      </style>

      <script>
        (function(){
          try {
            const ctx = document.getElementById('translationsTrendChart');
            if (ctx && window.Chart) {
              const labels = ${JSON.stringify(chartLabels)};
              const data = ${JSON.stringify(chartData)};
              const chart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                  labels,
                  datasets: [{
                    label: 'Translations',
                    data,
                    fill: true,
                    tension: 0.35,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102,126,234,0.12)',
                    pointRadius: 3,
                    pointHoverRadius: 5,
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { grid: { display:false } },
                    y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { precision: 0 } }
                  }
                }
              });
            }
          } catch (e) { /* no-op */ }
        })();
      </script>
    </div>`;
}

/**
 * Generates the HTML content for the monetization tab.
 * @param {Object} client - The Discord client instance.
 * @returns {Promise<string>} The HTML content for the monetization interface.
 */
async function generateMonetizationContent(client) {
    try {
        const settings = monetizationService.getSettings();
        const serversStatus = await monetizationService.getAllServersStatus(client);
        // Get vote statistics
        const voteStats = await monetizationService.getVoteStats();
        // Get all pending premium requests (limit 0 = no limit)
        const pendingPremium = await databaseService.getPendingPremiumRequests(0);
        // Calculate duplicates by serverId
        const duplicateCounts = pendingPremium.reduce((acc, pr) => {
            const sid = pr.serverId || 'unknown';
            acc[sid] = (acc[sid] || 0) + 1;
            return acc;
        }, {});
        // Enrich recent votes with Discord user info (only up to 20) to show proper @username
        let enrichedRecentVotes = voteStats.recentVotes.slice(0, 20);
        if (client && enrichedRecentVotes.length) {
            enrichedRecentVotes = await Promise.all(enrichedRecentVotes.map(async (vote) => {
                const uid = vote?.user?.id;
                if (!uid) return vote;

                // If username seems missing or numeric-only, try to fill from Discord API
                const currentName = vote.user.displayName || vote.user.username || '';
                const needsEnrich = !currentName || /^\d+$/.test(currentName);
                if (!needsEnrich) return vote;

                try {
                    const cached = client.users.cache.get(uid);
                    if (cached) {
                        return {
                            ...vote,
                            user: {
                                ...vote.user,
                                username: cached.username || vote.user.username,
                                displayName: cached.displayName || cached.username || vote.user.displayName || vote.user.username
                            }
                        };
                    }
                    const fetched = await client.users.fetch(uid);
                    return {
                        ...vote,
                        user: {
                            ...vote.user,
                            username: fetched?.username || vote.user.username,
                            displayName: fetched?.displayName || fetched?.username || vote.user.displayName || vote.user.username
                        }
                    };
                } catch (_) {
                    return vote;
                }
            }));
        }
        
        // Calculate global statistics
        const totalServers = serversStatus.length;
        const totalTranslations = serversStatus.reduce((sum, server) => sum + server.translationCount, 0);
        const exemptServers = serversStatus.filter(server => server.isExempt).length;
        const restrictedServers = serversStatus.filter(server => server.isRestricted).length;
        const overLimitServers = serversStatus.filter(server => !server.canTranslate && !server.isExempt).length;
        const activeServers = serversStatus.filter(server => server.canTranslate || server.isExempt).length;
        
        return `
            <div class="monetization-container">
                <div class="monetization-head">
                    <div class="title">💰 Monetization Management</div>
                    <span class="chip">Admin • Secure</span>
                </div>
                
                <!-- Global Statistics Section -->
                <div class="stats-section">
                    <h3>Global Statistics</h3>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon">🏢</div>
                            <div class="stat-info">
                                <div class="stat-value">${totalServers}</div>
                                <div class="stat-label">Total Servers</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">🔄</div>
                            <div class="stat-info">
                                <div class="stat-value">${totalTranslations.toLocaleString()}</div>
                                <div class="stat-label">Total Translations</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">✅</div>
                            <div class="stat-info">
                                <div class="stat-value">${activeServers}</div>
                                <div class="stat-label">Active Servers</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">💎</div>
                            <div class="stat-info">
                                <div class="stat-value">${exemptServers}</div>
                                <div class="stat-label">Exempt Servers</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">🚫</div>
                            <div class="stat-info">
                                <div class="stat-value">${overLimitServers}</div>
                                <div class="stat-label">Over Limit</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">⚠️</div>
                            <div class="stat-info">
                                <div class="stat-value">${restrictedServers}</div>
                                <div class="stat-label">Restricted Servers</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Vote Tracking Section -->
                <div class="stats-section">
                    <h3>🗳️ Vote Tracking & Auto-Credits</h3>
                    <div class="stats-grid">
                        <div class="stat-card vote-card">
                            <div class="stat-icon">🎯</div>
                            <div class="stat-info">
                                <div class="stat-value">${voteStats.totalVoteClicks}</div>
                                <div class="stat-label">Total Vote Clicks</div>
                            </div>
                        </div>
                        <div class="stat-card vote-card">
                            <div class="stat-icon">💎</div>
                            <div class="stat-info">
                                <div class="stat-value">${voteStats.totalCreditsGranted.toLocaleString()}</div>
                                <div class="stat-label">Credits Auto-Granted</div>
                            </div>
                        </div>
                        <div class="stat-card vote-card">
                            <div class="stat-icon">📅</div>
                            <div class="stat-info">
                                <div class="stat-value">${voteStats.todayVotes}</div>
                                <div class="stat-label">Today's Votes</div>
                            </div>
                        </div>
                        <div class="stat-card vote-card">
                            <div class="stat-icon">⚡</div>
                            <div class="stat-info">
                                <div class="stat-value" id="recentActivityCount">${voteStats.recentVotesCount}</div>
                                <div class="stat-label">Recent Activity</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Recent Votes Table -->
                    <div class="recent-votes-section">
                        <div class="section-head">
                            <h4>Recent Vote Activity (Last 20)</h4>
                            <button class="refresh-btn" onclick="refreshRecentVotes()">↻ Refresh</button>
                        </div>
                        <div class="filters" style="display:flex; gap:10px; align-items:center; margin: 8px 0 12px 0;">
                            <label for="voteStatusFilter" style="font-size:12px; color:#6b7280;">Status</label>
                            <select id="voteStatusFilter" style="padding:6px 10px; border:1px solid #e5e7eb; border-radius:6px; background:#fff;">
                                <option value="all" selected>All</option>
                                <option value="granted">Granted</option>
                                <option value="blocked">Blocked</option>
                            </select>
                            <label for="voteServerFilter" style="font-size:12px; color:#6b7280;">Server ID</label>
                            <input id="voteServerFilter" type="text" placeholder="e.g. 1234567890" style="flex:0 1 220px; padding:6px 10px; border:1px solid #e5e7eb; border-radius:6px;" />
                            <button id="clearVoteFilters" class="btn btn-sm btn-outline-secondary" style="margin-left:auto;" title="Clear filters">Clear</button>
                        </div>
                        <div class="table-scroll" id="recentVotesContainer">
                        <table class="table vote-table">
                            <thead>
                                <tr>
                                    <th>Server ID</th>
                                    <th>User</th>
                                    <th style="text-align: center;">Credits Granted</th>
                                    <th style="text-align: center;">Timestamp</th>
                                    <th style="text-align: center;">Status</th>
                                    <th style="text-align: center;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="recentVotesTbody">
                                ${enrichedRecentVotes.map(vote => {
                                    const server = client ? client.guilds.cache.get(vote.serverId) : null;
                                    const serverName = server ? server.name : 'Unknown Server';
                                    const timeAgo = new Date(vote.timestamp).toLocaleString();
                                    const rawName = vote.user ? (vote.user.displayName || vote.user.username || '') : '';
                                    const isNumericOnly = /^\d+$/.test(rawName);
                                    const safeName = vote.user ? (
                                        isNumericOnly
                                            ? `user_${(vote.user.id || '').toString().slice(-4)}`
                                            : rawName || `user_${(vote.user.id || '').toString().slice(-4)}`
                                    ) : 'unknown_user';
                                    const userDisplay = vote.user ? 
                                        `<span class="user-mention">@${safeName}</span>
                                            <br>
                                            <small class="text-muted">ID: ${vote.user.id}</small>
                                            <br><small class="${vote.creditsGranted > 0 ? 'text-success' : 'text-warning'}">
                                                Status: ${vote.creditsGranted > 0 ? 'Credits Granted' : 'Blocked (Cooldown)'}
                                            </small>
                                            <div class="mt-1">
                                                <button class="btn btn-sm btn-outline-secondary me-1" onclick="copyToClipboard('${vote.user.id}')">
                                                    Copy ID
                                                </button>
                                                <button class="btn btn-sm btn-outline-info" onclick="window.open('https://discord.com/users/${vote.user.id}', '_blank')">
                                                    Profile
                                                </button>
                                            </div>` : 
                                        '<span class="no-user">Unknown User</span>';
                                    return `
                                    <tr>
                                        <td>
                                            <div class="server-info">
                                                <strong>${vote.serverId}</strong>
                                                <small>${serverName}</small>
                                            </div>
                                        </td>
                                        <td>${userDisplay}</td>
                                        <td style="text-align: center;"><span class="credit-badge">+${vote.creditsGranted}</span></td>
                                        <td style="text-align: center;">${timeAgo}</td>
                                        <td style="text-align: center;"><span class="status-success">✅ Granted</span></td>
                                        <td style="text-align: center;">
                                            <button class="btn btn-sm btn-outline-danger" onclick="deleteVoteRecord('${vote.id}')">Delete</button>
                                        </td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                        </div>
                        <script>
                            async function deleteVoteRecord(voteId) {
                                if (!voteId) return;
                                if (!confirm('Are you sure you want to permanently delete this vote record?')) return;
                                try {
                                    const res = await fetch('/admin/monetization/vote/delete', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ voteId })
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                        if (typeof showNotification === 'function') {
                                            showNotification('Vote record deleted.', 'success');
                                        }
                                        await refreshRecentVotes(true);
                                    } else {
                                        alert('Failed to delete: ' + (data.message || 'Unknown error'));
                                    }
                                } catch (e) {
                                    alert('Error deleting vote: ' + e.message);
                                }
                            }

                            function debounce(fn, delay){ let t; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args), delay); }; }

                            async function refreshRecentVotes(silent = false) {
                                try {
                                    const statusEl = document.getElementById('voteStatusFilter');
                                    const serverEl = document.getElementById('voteServerFilter');
                                    const status = statusEl ? statusEl.value : 'all';
                                    const serverId = serverEl ? serverEl.value.trim() : '';
                                    const qs = new URLSearchParams({ ts: Date.now().toString(), status, serverId }).toString();
                                    const res = await fetch('/admin/monetization/recent-votes?' + qs, { headers: { 'Accept': 'application/json' } });
                                    if (!res.ok) throw new Error('Failed to fetch');
                                    const payload = await res.json();
                                    if (!payload || !payload.success) throw new Error(payload?.message || 'Unknown error');
                                    const tbody = document.getElementById('recentVotesTbody');
                                    if (tbody) tbody.innerHTML = payload.tbody || '';
                                    const countEl = document.getElementById('recentActivityCount');
                                    if (countEl && typeof payload.count === 'number') countEl.textContent = payload.count;
                                    if (!silent && typeof showNotification === 'function') {
                                        showNotification('Recent votes updated', 'success');
                                    }
                                } catch (err) {
                                    if (!silent) alert('Could not refresh votes: ' + err.message);
                                }
                            }

                            // Auto-refresh every 30s to keep the list up to date
                            setInterval(() => refreshRecentVotes(true), 30000);

                            // Wire filters
                            document.getElementById('voteStatusFilter')?.addEventListener('change', () => refreshRecentVotes(true));
                            const debouncedFilter = debounce(() => refreshRecentVotes(true), 400);
                            document.getElementById('voteServerFilter')?.addEventListener('input', debouncedFilter);
                            document.getElementById('clearVoteFilters')?.addEventListener('click', () => {
                                const s = document.getElementById('voteStatusFilter');
                                const sv = document.getElementById('voteServerFilter');
                                if (s) s.value = 'all';
                                if (sv) sv.value = '';
                                refreshRecentVotes(true);
                            });
                        </script>
                    </div>
                </div>
                
                <!-- Premium Requests Section -->
                <div class="stats-section">
                    <h3>💳 Premium Requests</h3>
                    <div class="stats-grid" style="margin-bottom:12px;">
                        <div class="stat-card">
                            <div class="stat-icon">⏳</div>
                            <div class="stat-info">
                                <div class="stat-value">${pendingPremium.length}</div>
                                <div class="stat-label">Pending Reviews</div>
                            </div>
                        </div>
                    </div>
                    <div class="recent-votes-section">
                        <div class="section-head">
                            <h4>Pending Premium Requests</h4>
                        </div>
                        <div class="table-scroll">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Request ID</th>
                                        <th>Server</th>
                                        <th>Server ID</th>
                                        <th>Requester</th>
                                        <th>Created</th>
                                        <th style="min-width:220px">Approve</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${pendingPremium.map(pr => `
                                        <tr>
                                            <td><code>${pr._id}</code> ${ (duplicateCounts[pr.serverId]||0) > 1 ? '<span class="badge dup" title="Duplicate request for same server">Duplicate</span>' : '' }</td>
                                            <td>${pr.serverName || 'Unknown'}</td>
                                            <td>${pr.serverId}</td>
                                            <td>${(pr.requesterDisplayName || pr.requesterUsername || 'user') + ' (' + pr.requesterUserId + ')'}</td>
                                            <td>${new Date(pr.createdAt).toLocaleString()}</td>
                                            <td>
                                                <div style="display:flex; gap:8px; align-items:center;">
                                                    <input type="number" min="1" max="3650" value="30" id="dur_${pr._id}" style="width:90px; padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px;" title="Duration in days" />
                                                    <button class="btn btn-exempt" onclick="approvePremium('${pr._id}', '${pr.serverId}')">Approve</button>
                                                    <button class="btn warn" style="background:#ef4444;color:#fff;" onclick="rejectPremium('${pr._id}', '${pr.serverId}')">Reject</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                    ${pendingPremium.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:#6b7280;">No pending requests</td></tr>' : ''}
                                </tbody>
                            </table>
                        </div>
                        <script>
                          async function approvePremium(reqId, serverId){
                            try{
                              const input = document.getElementById('dur_' + reqId);
                              const days = parseInt(input && input.value ? input.value : '30', 10);
                              const res = await fetch('/admin/monetization/premium/approve', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ requestId: reqId, durationDays: isNaN(days)?30:days })
                              });
                              const data = await res.json();
                              if(data.success){
                                if (typeof showNotification === 'function') {
                                  showNotification('Premium approved for ' + (data.serverName||serverId), 'success');
                                } else {
                                  alert('Approved!');
                                }
                                // Simple refresh to update pending list
                                window.location.reload();
                              } else {
                                alert('Failed to approve: ' + (data.message || 'Unknown error'));
                              }
                            } catch(err){
                              alert('Error approving: ' + err.message);
                            }
                          }

                          async function rejectPremium(reqId, serverId){
                            try {
                              const reason = prompt('Optional: Provide a reason for rejection (shown to requester).', '');
                              const res = await fetch('/admin/monetization/premium/reject', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ requestId: reqId, reason: reason || null })
                              });
                              const data = await res.json();
                              if (data.success) {
                                if (typeof showNotification === 'function') {
                                  showNotification('Premium request rejected for ' + (data.serverName || serverId), 'warn');
                                } else {
                                  alert('Rejected');
                                }
                                window.location.reload();
                              } else {
                                alert('Failed to reject: ' + (data.message || 'Unknown error'));
                              }
                            } catch (err) {
                              alert('Error rejecting: ' + err.message);
                            }
                          }
                        </script>
                    </div>
                </div>
                
                <!-- Global Settings Section -->
                <div class="settings-section">
                    <h3>Global Settings</h3>
                    <div class="settings-card">
                        <div class="setting-group">
                            <label for="freeLimit">Default Free Translation Limit:</label>
                            <input type="number" id="freeLimit" value="${settings.defaultFreeTranslationLimit}" min="1" max="1000">
                            <small>Default number of free translations for new servers</small>
                        </div>
                        
                        <div class="setting-group">
                            <label class="toggle-container">
                                <input type="checkbox" id="globalRestriction" ${settings.enableGlobalRestriction ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                                Apply restriction to all servers
                            </label>
                            <small>When enabled, all servers will be restricted unless specifically exempted</small>
                        </div>
                        
                        <button class="save-btn" onclick="saveGlobalSettings()">Save Global Settings</button>
                    </div>
                </div>
                
                <!-- Quick Actions Section -->
                <div class="quick-actions-section">
                    <h3>Quick Actions</h3>
                    <div class="actions-card">
                        <div class="action-group">
                            <input type="text" id="serverIdInput" placeholder="Enter Server ID" class="server-input">
                            <div class="action-buttons">
                                <button class="action-btn exempt-btn" onclick="addExemptServer()">Add to Exempt List</button>
                                <button class="action-btn restrict-btn" onclick="addRestrictedServer()">Add to Restricted List</button>
                                <button class="action-btn reset-btn" onclick="resetServerCount()">Reset Translation Count</button>
                            </div>
                        </div>
                        <div class="action-group" style="margin-top: 15px;">
                            <input type="number" id="customLimitInput" placeholder="Custom Limit (optional)" class="server-input" min="1" max="10000">
                            <div class="action-buttons">
                                <button class="action-btn limit-btn" onclick="setCustomLimit()">Set Custom Limit</button>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Bulk Actions Section -->
                <div class="bulk-actions-section">
                    <h3>🔄 Bulk Server Actions</h3>
                    <div class="actions-card bulk-card">
                        <div class="bulk-description">
                            <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Apply restrictions or exemptions to multiple servers at once. Use these actions carefully as they affect all servers.</p>
                        </div>
                        <div class="bulk-controls">
                            <div class="bulk-row">
                                <div class="bulk-info">
                                    <span class="bulk-icon">🚫</span>
                                    <div>
                                        <div class="bulk-title">Restrict All Servers</div>
                                        <div class="bulk-subtitle">Apply default restrictions to all servers (exempted servers won't be affected)</div>
                                    </div>
                                </div>
                                <button class="action-btn restrict-btn" onclick="bulkRestrictAll()">
                                    <span>🔒</span> Apply Restrictions to All
                                </button>
                            </div>
                            <div class="bulk-row">
                                <div class="bulk-info">
                                    <span class="bulk-icon">✅</span>
                                    <div>
                                        <div class="bulk-title">Remove All Restrictions</div>
                                        <div class="bulk-subtitle">Remove restrictions from all servers (won't affect exempted servers)</div>
                                    </div>
                                </div>
                                <button class="action-btn reset-btn" onclick="bulkRemoveRestrictions()">
                                    <span>🔓</span> Remove All Restrictions
                                </button>
                            </div>
                            <div class="bulk-row">
                                <div class="bulk-info">
                                    <span class="bulk-icon">🔄</span>
                                    <div>
                                        <div class="bulk-title">Reset All Translation Counts</div>
                                        <div class="bulk-subtitle">Reset translation counter to 0 for all servers</div>
                                    </div>
                                </div>
                                <button class="action-btn limit-btn" onclick="bulkResetCounts()">
                                    <span>↻</span> Reset All Counts
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Servers Status Section -->
                <div class="servers-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h3 style="margin: 0;">Servers Management</h3>
                        <div class="servers-count-badge">
                            <span style="font-size: 14px; font-weight: 600; color: #667eea;">
                                ${serversStatus.length} servers total
                            </span>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <input 
                            type="text" 
                            id="monetizationSearchInput" 
                            class="search-input" 
                            placeholder="🔍 Search servers by name, ID, or any text..."
                            onkeyup="searchMonetizationServers()"
                            style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px; outline: none; transition: border-color 0.2s;"
                        />
                    </div>
                    
                    <div class="filters">
                        <button class="filter-btn active" onclick="filterServers('all')">All Servers</button>
                        <button class="filter-btn" onclick="filterServers('restricted')">Restricted</button>
                        <button class="filter-btn" onclick="filterServers('exempt')">Exempt</button>
                        <button class="filter-btn" onclick="filterServers('over-limit')">Over Limit</button>
                    </div>
                    
                    <div class="servers-table-container">
                        <table class="servers-table">
                            <thead>
                                <tr>
                                    <th>Server Name</th>
                                    <th>Server ID</th>
                                    <th>Members</th>
                                    <th>Translations</th>
                                    <th>Status</th>
                                    <th>Exemption</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${serversStatus.map(server => `
                                    <tr class="server-row" data-status="${getServerStatusClass(server)}">
                                        <td class="server-name">${server.name}</td>
                                        <td class="server-id">${server.id}</td>
                                        <td class="member-count">${server.memberCount || 'N/A'}</td>
                                        <td class="translation-count">
                                            <span class="${server.translationCount >= server.freeTranslationLimit ? 'over-limit' : ''}">${server.translationCount}/${server.freeTranslationLimit}</span>
                                        </td>
                                        <td class="server-status">
                                            <span class="status-badge ${getServerStatusClass(server)}">
                                                ${getServerStatusText(server)}
                                            </span>
                                        </td>
                                        <td>
                                            ${(() => {
                                                if (server.isExempt) {
                                                    if (server.exemptUntil) {
                                                        const until = new Date(server.exemptUntil);
                                                        const now = new Date();
                                                        const diffMs = until - now;
                                                        if (diffMs > 0) {
                                                            const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                                                            return `<span title="Exemption expires ${until.toLocaleString()}" class="status-badge exempt">Until ${until.toLocaleDateString()} (${daysLeft}d left)</span>`;
                                                        } else {
                                                            return `<span class="status-badge restricted" title="Exemption expired, server is now restricted">Expired (Restricted)</span>`;
                                                        }
                                                    }
                                                    return `<span class="status-badge exempt">Unlimited</span>`;
                                                }
                                                return '<span class="status-badge">—</span>';
                                            })()}
                                        </td>
                                        <td class="server-actions">
                                            ${generateServerActions(server)}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <style>
                .monetization-container {
                    padding: 20px;
                    color: #1f2937;
                }
                .monetization-container .monetization-head {
                    display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px;
                }
                .monetization-container .monetization-head .title {
                    display:flex; align-items:center; gap:10px; font-weight:800; font-size:20px;
                }
                .monetization-container .chip {
                    display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 10px; border-radius:999px; background:#eef2ff; color:#4f46e5; border:1px solid #e0e7ff;
                }
                /* Shared card primitives */
                .monetization-container .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,.04); }
                .monetization-container .card-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f3f4f6; font-weight:700; }
                .monetization-container .card-body { padding:16px; }
                /* Elevate stat cards */
                .monetization-container .stat-card { border:1px solid #e5e7eb; border-radius:12px; background:#fff; box-shadow:0 6px 18px rgba(0,0,0,.05); }
                .monetization-container .stat-card .stat-icon { font-size:28px; }
                .monetization-container .stat-card .stat-value { font-size:28px; font-weight:800; color:#111827; }
                .monetization-container .stat-card .stat-label { color:#6b7280; font-weight:600; }
                /* Unify tables */
                .monetization-container .table, .monetization-container .servers-table { width:100%; border-collapse:separate; border-spacing:0; }
                .monetization-container .table thead th, .monetization-container .servers-table thead th { background:#f9fafb; color:#374151; font-weight:700; border-bottom:1px solid #e5e7eb; padding:12px; position:sticky; top:0; z-index:1; }
                .monetization-container .table tbody td, .monetization-container .servers-table tbody td { padding:12px; border-bottom:1px solid #f3f4f6; color:#374151; }
                .monetization-container .table tbody tr:hover, .monetization-container .servers-table tbody tr:hover { background:#f9fafb; }
                /* Recent votes container as card */
                .monetization-container .recent-votes-section { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,.04); padding:12px; }
                .monetization-container .recent-votes-section h4 { margin:8px 8px 12px; font-size:15px; color:#111827; }
                .monetization-container .section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin: 8px 6px 10px; }
                .monetization-container .table-scroll { max-height: 420px; overflow-y: auto; border:1px solid #f3f4f6; border-radius:10px; }
                .monetization-container .table-scroll table { margin: 0; }
                .monetization-container .refresh-btn { appearance:none; border:1px solid #e5e7eb; background:#fff; border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer; color:#374151; }
                .monetization-container .refresh-btn:hover { background:#f9fafb; }
                /* Small badges */
                .monetization-container .badge { display:inline-block; padding:2px 6px; border-radius:999px; font-size:10px; font-weight:700; vertical-align:middle; }
                .monetization-container .badge.dup { background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; margin-left:6px; }
                /* Settings and actions adopt card primitives */
                .monetization-container .settings-card, .monetization-container .actions-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,.04); }
                /* Servers table container as card */
                .monetization-container .servers-table-container { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,.04); overflow:hidden; }
                /* Badges */
                .monetization-container .status-badge { border:1px solid #e5e7eb; }
                .monetization-container .status-badge.active { background:#ecfdf5; color:#065f46; border-color:#a7f3d0; }
                .monetization-container .status-badge.restricted { background:#fef2f2; color:#991b1b; border-color:#fecaca; }
                .monetization-container .status-badge.exempt { background:#eff6ff; color:#1e40af; border-color:#bfdbfe; }
                .monetization-container .status-badge.over-limit { background:#fff7ed; color:#9a3412; border-color:#fed7aa; }
                /* Buttons */
                .monetization-container .btn, .monetization-container .save-btn, .monetization-container .action-btn, .monetization-container .filter-btn, .monetization-container .server-actions button {
                    appearance:none; border:0; border-radius:10px; padding:10px 14px; font-weight:700; cursor:pointer; transition:filter .15s, transform .04s; display:inline-flex; align-items:center; gap:8px;
                }
                .monetization-container .save-btn { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border:none; }
                .monetization-container .action-btn.exempt-btn, .monetization-container .btn-exempt { background:#10b981; color:#fff; }
                .monetization-container .action-btn.restrict-btn, .monetization-container .btn-restrict { background:#ef4444; color:#fff; }
                .monetization-container .action-btn.reset-btn, .monetization-container .btn-reset { background:#f59e0b; color:#111827; }
                .monetization-container .action-btn.limit-btn { background:#06b6d4; color:#fff; }
                .monetization-container .filter-btn { background:#fff; color:#374151; border:1px solid #e5e7eb; border-radius:999px; }
                .monetization-container .filter-btn.active { background:#6366f1; color:#fff; border-color:#6366f1; }
                .monetization-container .btn:hover, .monetization-container .save-btn:hover, .monetization-container .action-btn:hover, .monetization-container .filter-btn:hover, .monetization-container .server-actions button:hover { filter:brightness(1.04); }
                .monetization-container .btn:active, .monetization-container .save-btn:active, .monetization-container .action-btn:active, .monetization-container .filter-btn:active, .monetization-container .server-actions button:active { transform: translateY(1px); }
                /* Inputs */
                .monetization-container input[type="number"], .monetization-container input[type="text"] { background:#f9fafb; border:1.5px solid #e5e7eb; }
                .monetization-container input[type="number"]:focus, .monetization-container input[type="text"]:focus { border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.18); outline:none; }
                
                .stats-section, .settings-section, .quick-actions-section, .servers-section {
                    margin-bottom: 30px;
                }
                
                .bulk-actions-section {
                    margin-bottom: 30px;
                }
                
                .bulk-actions-section h3 {
                    color: #333;
                    margin-bottom: 15px;
                    padding-bottom: 8px;
                    border-bottom: 2px solid #667eea;
                }
                
                .bulk-card {
                    background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05));
                    border-left: 4px solid #667eea;
                }
                
                .bulk-description {
                    padding: 14px 18px;
                    background: rgba(255, 255, 255, 0.7);
                    border-radius: 8px;
                    margin-bottom: 16px;
                }
                
                .bulk-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                
                .bulk-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px;
                    background: white;
                    border-radius: 10px;
                    border: 1px solid #e5e7eb;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                    transition: all 0.2s ease;
                }
                
                .bulk-row:hover {
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                    transform: translateY(-1px);
                }
                
                .bulk-info {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    flex: 1;
                }
                
                .bulk-icon {
                    font-size: 32px;
                    opacity: 0.8;
                }
                
                .bulk-title {
                    font-weight: 700;
                    color: #111827;
                    font-size: 15px;
                    margin-bottom: 4px;
                }
                
                .bulk-subtitle {
                    font-size: 13px;
                    color: #6b7280;
                    line-height: 1.4;
                }
                
                .stats-section, .settings-section, .quick-actions-section, .servers-section {
                    margin-bottom: 30px;
                }
                
                .stats-section h3, .settings-section h3, .quick-actions-section h3, .servers-section h3 {
                    color: #333;
                    margin-bottom: 15px;
                    padding-bottom: 8px;
                    border-bottom: 2px solid #667eea;
                }
                
                /* Global Stats Grid */
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 20px;
                }
                
                .stat-card {
                    background: white;
                    padding: 20px;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.07);
                    border: 1px solid #e1e8ed;
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                
                .stat-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.1);
                }
                
                .stat-icon {
                    font-size: 2.5rem;
                    opacity: 0.8;
                }
                
                .stat-info {
                    flex: 1;
                }
                
                .stat-value {
                    font-size: 2rem;
                    font-weight: bold;
                    color: #333;
                    line-height: 1;
                }
                
                .stat-label {
                    font-size: 0.875rem;
                    color: #666;
                    margin-top: 4px;
                    font-weight: 500;
                }
                
                .settings-card, .actions-card {
                    background: white;
                    padding: 25px;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.07);
                    border: 1px solid #e1e8ed;
                }
                
                .setting-group {
                    margin-bottom: 20px;
                }
                
                .setting-group label {
                    display: block;
                    font-weight: 600;
                    margin-bottom: 8px;
                    color: #333;
                }
                
                .setting-group input[type="number"] {
                    width: 200px;
                    padding: 10px 15px;
                    border: 2px solid #e1e8ed;
                    border-radius: 8px;
                    font-size: 14px;
                    transition: border-color 0.3s ease;
                }
                
                .setting-group input[type="number"]:focus {
                    outline: none;
                    border-color: #667eea;
                    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
                }
                
                .setting-group small {
                    display: block;
                    color: #666;
                    margin-top: 5px;
                    font-size: 12px;
                }
                
                /* Toggle Switch Styles */
                .toggle-container {
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                }
                
                .toggle-container input[type="checkbox"] {
                    display: none;
                }
                
                .toggle-slider {
                    position: relative;
                    display: inline-block;
                    width: 50px;
                    height: 24px;
                    background-color: #ccc;
                    border-radius: 24px;
                    margin-right: 10px;
                    transition: background-color 0.3s ease;
                }
                
                .toggle-slider:before {
                    content: "";
                    position: absolute;
                    height: 20px;
                    width: 20px;
                    left: 2px;
                    bottom: 2px;
                    background-color: white;
                    border-radius: 50%;
                    transition: transform 0.3s ease;
                }
                
                .toggle-container input:checked + .toggle-slider {
                    background-color: #667eea;
                }
                
                .toggle-container input:checked + .toggle-slider:before {
                    transform: translateX(26px);
                }
                
                /* Button Styles */
                .save-btn, .action-btn {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-size: 14px;
                }
                
                .save-btn {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                
                .save-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
                }
                
                .action-group {
                    display: flex;
                    gap: 15px;
                    align-items: center;
                    flex-wrap: wrap;
                }
                
                .server-input {
                    flex: 1;
                    min-width: 200px;
                    padding: 10px 15px;
                    border: 2px solid #e1e8ed;
                    border-radius: 8px;
                    font-size: 14px;
                }
                
                .action-buttons {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                
                .exempt-btn {
                    background: #28a745;
                    color: white;
                }
                
                .restrict-btn {
                    background: #dc3545;
                    color: white;
                }
                
                .reset-btn {
                    background: #ffc107;
                    color: #333;
                }
                
                .limit-btn {
                    background: #17a2b8;
                    color: white;
                }
                
                .action-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                }
                
                /* Filters */
                .filters {
                    margin-bottom: 20px;
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                
                .servers-count-badge {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 14px;
                    font-weight: 600;
                    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
                }
                
                .filter-btn {
                    padding: 8px 16px;
                    border: 2px solid #e1e8ed;
                    background: white;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-size: 14px;
                    font-weight: 500;
                }
                
                .filter-btn.active,
                .filter-btn:hover {
                    background: #667eea;
                    color: white;
                    border-color: #667eea;
                }
                
                /* Table Styles */
                .servers-table-container {
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.07);
                    border: 1px solid #e1e8ed;
                }
                
                .servers-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                
                .servers-table th {
                    background: #f8f9fa;
                    padding: 15px 12px;
                    text-align: left;
                    font-weight: 600;
                    color: #333;
                    border-bottom: 2px solid #e1e8ed;
                }
                
                .servers-table td {
                    padding: 12px;
                    border-bottom: 1px solid #f0f0f0;
                    vertical-align: middle;
                }
                
                .server-row:hover {
                    background: #f8f9fa;
                }
                
                .server-name {
                    font-weight: 600;
                    color: #333;
                }
                
                .server-id {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 11px;
                    color: #666;
                    max-width: 120px;
                    word-break: break-all;
                    line-height: 1.3;
                }
                
                .translation-count .over-limit {
                    color: #dc3545;
                    font-weight: bold;
                }
                
                .status-badge {
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                
                .status-badge.active {
                    background: #d4edda;
                    color: #155724;
                }
                
                .status-badge.restricted {
                    background: #f8d7da;
                    color: #721c24;
                }
                
                .status-badge.exempt {
                    background: #d1ecf1;
                    color: #0c5460;
                }
                
                .status-badge.over-limit {
                    background: #f5c6cb;
                    color: #721c24;
                }
                
                .server-actions {
                    display: flex;
                    gap: 5px;
                    flex-wrap: wrap;
                }
                
                .server-actions button {
                    padding: 6px 12px;
                    border: none;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .btn-exempt {
                    background: #28a745;
                    color: white;
                }
                
                .btn-restrict {
                    background: #dc3545;
                    color: white;
                }
                
                .btn-remove {
                    background: #6c757d;
                    color: white;
                }
                
                .btn-reset {
                    background: #ffc107;
                    color: #333;
                }
                
                .server-actions button:hover {
                    transform: scale(1.05);
                }
                /* Vote table and utility styles */
                .vote-table { width:100%; }
                .vote-table .user-mention { font-weight:700; color:#111827; }
                .vote-table .no-user { color:#6b7280; font-style:italic; }
                .vote-table .server-info strong { display:block; font-size:12px; color:#111827; }
                .vote-table .server-info small { color:#6b7280; }
                .credit-badge { display:inline-block; padding:4px 10px; border-radius:999px; background:#ecfdf5; color:#065f46; font-weight:700; border:1px solid #a7f3d0; }
                .status-success { color:#059669; font-weight:700; }
                .text-muted { color:#6b7280; }
                .text-success { color:#059669; }
                .text-warning { color:#d97706; }
                .me-1 { margin-right:6px; }
                .mt-1 { margin-top:6px; }
                .btn-sm { padding:6px 10px !important; font-size:12px; border-radius:8px; font-weight:700; }
                .btn-outline-secondary { background:#fff; color:#334155; border:1px solid #cbd5e1; }
                .btn-outline-secondary:hover { background:#f1f5f9; }
                .btn-outline-info { background:#fff; color:#0ea5e9; border:1px solid #bae6fd; }
                .btn-outline-info:hover { background:#e0f2fe; }
                .btn-outline-danger { background:#fff; color:#ef4444; border:1px solid #fecaca; }
                .btn-outline-danger:hover { background:#fee2e2; }
                
                /* Responsive */
                @media (max-width: 768px) {
                    .action-group {
                        flex-direction: column;
                        align-items: stretch;
                    }
                    
                    .action-buttons {
                        justify-content: center;
                    }
                    
                    .servers-table-container {
                        overflow-x: auto;
                    }
                    
                    .servers-table {
                        min-width: 800px;
                    }
                }
            </style>
        `;
    } catch (error) {
        console.error('Error generating monetization content:', error);
        return `
            <div class="error-message">
                <h3>Error Loading Monetization Data</h3>
                <p>There was an error loading the monetization interface. Please try refreshing the page.</p>
                <p style="color: #666; font-size: 14px;">Error: ${error.message}</p>
            </div>
        `;
    }
}

function getServerStatusClass(server) {
    // Check if exemption has expired
    if (server.isExempt && server.exemptUntil) {
        const until = new Date(server.exemptUntil);
        if (until.getTime() < Date.now()) {
            // Exemption has expired, treat as restricted
            return 'restricted';
        }
    }
    
    if (server.isExempt) return 'exempt';
    if (!server.canTranslate) return 'over-limit';
    if (server.isRestricted) return 'restricted';
    return 'active';
}

function getServerStatusText(server) {
    // Check if exemption has expired
    if (server.isExempt && server.exemptUntil) {
        const until = new Date(server.exemptUntil);
        if (until.getTime() < Date.now()) {
            // Exemption has expired, treat as restricted
            return 'Restricted (Exemption Expired)';
        }
    }
    
    if (server.isExempt) return 'Exempt';
    if (!server.canTranslate) return 'Over Limit';
    if (server.isRestricted) return 'Restricted';
    return 'Active';
}

function generateServerActions(server) {
    let actions = [];
    
    // Check if exemption has expired
    const hasExpiredExemption = server.isExempt && server.exemptUntil && 
                                 new Date(server.exemptUntil).getTime() < Date.now();
    
    if (server.isExempt && !hasExpiredExemption) {
        // Active exemption - show remove exempt button
        actions.push(`<button class="btn-remove" onclick="removeExemptServer('${server.id}')">Remove Exempt</button>`);
    } else if (server.isRestricted || hasExpiredExemption) {
        // Restricted or expired exemption - show add exempt and remove restriction buttons
        actions.push(`<button class="btn-exempt" onclick="addExemptServer('${server.id}')">Add Exempt</button>`);
        actions.push(`<button class="btn-remove" onclick="removeRestrictedServer('${server.id}')">Remove Restriction</button>`);
    } else {
        // Normal server - show add exempt and add restriction buttons
        actions.push(`<button class="btn-exempt" onclick="addExemptServer('${server.id}')">Add Exempt</button>`);
        actions.push(`<button class="btn-restrict" onclick="addRestrictedServer('${server.id}')">Add Restriction</button>`);
    }
    
    if (server.translationCount > 0) {
        actions.push(`<button class="btn-reset" onclick="resetServerCount('${server.id}')">Reset Count</button>`);
    }
    
    return actions.join('');
}

/**
 * Generates the HTML content for the Server Management tab.
 * @param {Object} client - The Discord client instance.
 * @returns {Promise<string>} The HTML content for server management.
 */
async function generateServerManagementContent(client) {
    try {
        if (!client || !client.guilds) {
            return `<div class="error-message">Discord client not available</div>`;
        }

        const servers = Array.from(client.guilds.cache.values())
            .filter(guild => guild && guild.id) // Filter out invalid guilds
            .map(guild => ({
                id: guild.id,
                name: guild.name || 'Unknown Server',
                memberCount: guild.memberCount || 0,
                joinedAt: guild.joinedAt || new Date(),
                icon: guild.iconURL({ size: 64 }) || null,
                owner: guild.ownerId || 'Unknown'
            }));

        // Sort by member count descending
        servers.sort((a, b) => b.memberCount - a.memberCount);

        const totalServers = servers.length;
        const totalMembers = servers.reduce((sum, s) => sum + s.memberCount, 0);
        const avgMembers = totalServers > 0 ? Math.round(totalMembers / totalServers) : 0;

        return `
            <div class="server-management-container">
                <style>
                    .server-management-container {
                        padding: 20px;
                        color: #1f2937;
                        max-width: 1400px;
                        margin: 0 auto;
                    }
                    
                    .sm-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        margin-bottom: 24px;
                        padding-bottom: 16px;
                        border-bottom: 2px solid #e5e7eb;
                        flex-wrap: wrap;
                        gap: 12px;
                    }
                    
                    .sm-header-left {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        flex-wrap: wrap;
                    }
                    
                    .sm-header h2 {
                        margin: 0;
                        font-size: 24px;
                        font-weight: 800;
                        color: #111827;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }
                    
                    .sm-badge {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        font-size: 12px;
                        padding: 6px 12px;
                        border-radius: 999px;
                        background: linear-gradient(135deg, #6366f1, #8b5cf6);
                        color: white;
                        font-weight: 700;
                    }
                    
                    .sm-view-toggle {
                        display: flex;
                        gap: 4px;
                        background: #f3f4f6;
                        padding: 4px;
                        border-radius: 10px;
                        border: 1px solid #e5e7eb;
                    }
                    
                    .sm-view-btn {
                        padding: 8px 12px;
                        border: none;
                        background: transparent;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 18px;
                        transition: all 0.2s ease;
                        color: #6b7280;
                    }
                    
                    .sm-view-btn.active {
                        background: white;
                        color: #6366f1;
                        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
                    }
                    
                    .sm-view-btn:hover:not(.active) {
                        color: #111827;
                    }
                    
                    .sm-stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                        gap: 16px;
                        margin-bottom: 24px;
                    }
                    
                    .sm-stat-card {
                        background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05));
                        border: 1px solid #e5e7eb;
                        border-radius: 16px;
                        padding: 20px;
                        display: flex;
                        align-items: center;
                        gap: 16px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
                        transition: all 0.2s ease;
                    }
                    
                    .sm-stat-card:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
                    }
                    
                    .sm-stat-icon {
                        font-size: 36px;
                        opacity: 0.9;
                    }
                    
                    .sm-stat-info {
                        flex: 1;
                    }
                    
                    .sm-stat-value {
                        font-size: 28px;
                        font-weight: 800;
                        color: #111827;
                        line-height: 1;
                        margin-bottom: 4px;
                    }
                    
                    .sm-stat-label {
                        font-size: 13px;
                        color: #6b7280;
                        font-weight: 600;
                    }
                    
                    .sm-search-bar {
                        margin-bottom: 20px;
                        display: flex;
                        gap: 12px;
                        align-items: center;
                    }
                    
                    .sm-search-input {
                        flex: 1;
                        padding: 12px 16px;
                        border: 2px solid #e5e7eb;
                        border-radius: 12px;
                        font-size: 15px;
                        background: white;
                        transition: all 0.2s ease;
                    }
                    
                    .sm-search-input:focus {
                        outline: none;
                        border-color: #6366f1;
                        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
                    }
                    
                    .sm-sort-select {
                        padding: 12px 16px;
                        border: 2px solid #e5e7eb;
                        border-radius: 12px;
                        font-size: 14px;
                        background: white;
                        cursor: pointer;
                        font-weight: 600;
                    }
                    
                    .sm-servers-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                        gap: 16px;
                    }
                    
                    .sm-servers-grid.list-view {
                        grid-template-columns: 1fr;
                        gap: 12px;
                    }
                    
                    .sm-servers-grid.list-view .sm-server-card {
                        flex-direction: row;
                        align-items: center;
                        padding: 16px 20px;
                    }
                    
                    .sm-servers-grid.list-view .sm-server-header {
                        flex: 1;
                        min-width: 0;
                    }
                    
                    .sm-servers-grid.list-view .sm-server-icon {
                        width: 48px;
                        height: 48px;
                        font-size: 20px;
                    }
                    
                    .sm-servers-grid.list-view .sm-server-stats {
                        flex: 0 0 auto;
                        background: transparent;
                        padding: 0;
                        gap: 24px;
                    }
                    
                    .sm-servers-grid.list-view .sm-stat-item {
                        text-align: left;
                    }
                    
                    .sm-servers-grid.list-view .sm-joined-date {
                        display: none;
                    }
                    
                    .sm-servers-grid.list-view .sm-server-actions {
                        flex: 0 0 auto;
                    }
                    
                    .sm-server-card {
                        background: white;
                        border: 1px solid #e5e7eb;
                        border-radius: 16px;
                        padding: 20px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
                        transition: all 0.2s ease;
                        display: flex;
                        flex-direction: column;
                        gap: 14px;
                        cursor: pointer;
                    }
                    
                    .sm-server-card:hover {
                        transform: translateY(-4px);
                        box-shadow: 0 12px 32px rgba(102, 126, 234, 0.15);
                        border-color: #8b5cf6;
                    }
                    
                    .sm-server-header {
                        display: flex;
                        align-items: center;
                        gap: 14px;
                    }
                    
                    .sm-server-icon {
                        width: 56px;
                        height: 56px;
                        border-radius: 16px;
                        background: linear-gradient(135deg, #6366f1, #8b5cf6);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 24px;
                        font-weight: 700;
                        color: white;
                        flex-shrink: 0;
                    }
                    
                    .sm-server-icon img {
                        width: 100%;
                        height: 100%;
                        border-radius: 16px;
                        object-fit: cover;
                    }
                    
                    .sm-server-info {
                        flex: 1;
                        min-width: 0;
                    }
                    
                    .sm-server-name {
                        font-weight: 700;
                        font-size: 16px;
                        color: #111827;
                        margin-bottom: 4px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    
                    .sm-server-id {
                        font-family: 'Courier New', monospace;
                        font-size: 11px;
                        color: #6b7280;
                    }
                    
                    .sm-server-stats {
                        display: flex;
                        gap: 12px;
                        padding: 12px;
                        background: #f9fafb;
                        border-radius: 10px;
                    }
                    
                    .sm-stat-item {
                        flex: 1;
                        text-align: center;
                    }
                    
                    .sm-stat-item-value {
                        font-weight: 800;
                        font-size: 16px;
                        color: #111827;
                    }
                    
                    .sm-stat-item-label {
                        font-size: 11px;
                        color: #6b7280;
                        text-transform: uppercase;
                        font-weight: 600;
                        margin-top: 2px;
                    }
                    
                    .sm-server-actions {
                        display: flex;
                        gap: 8px;
                    }
                    
                    .sm-btn {
                        flex: 1;
                        padding: 10px 14px;
                        border: none;
                        border-radius: 10px;
                        font-weight: 700;
                        font-size: 13px;
                        cursor: pointer;
                        transition: all 0.15s ease;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                    }
                    
                    .sm-btn:hover {
                        transform: translateY(-1px);
                        filter: brightness(1.05);
                    }
                    
                    .sm-btn:active {
                        transform: translateY(0);
                    }
                    
                    .sm-btn-leave {
                        background: linear-gradient(135deg, #ef4444, #dc2626);
                        color: white;
                    }
                    
                    .sm-btn-info {
                        background: linear-gradient(135deg, #6366f1, #8b5cf6);
                        color: white;
                    }
                    
                    .sm-joined-date {
                        font-size: 12px;
                        color: #6b7280;
                        padding: 8px 12px;
                        background: #f3f4f6;
                        border-radius: 8px;
                        text-align: center;
                    }
                    
                    .sm-empty {
                        text-align: center;
                        padding: 60px 20px;
                        color: #6b7280;
                    }
                    
                    .sm-empty-icon {
                        font-size: 64px;
                        margin-bottom: 16px;
                    }
                    
                    @media (max-width: 768px) {
                        .sm-servers-grid {
                            grid-template-columns: 1fr;
                        }
                        
                        .sm-header {
                            flex-direction: column;
                            align-items: flex-start;
                        }
                        
                        .sm-header-left {
                            width: 100%;
                        }
                        
                        .sm-view-toggle {
                            width: 100%;
                            justify-content: center;
                        }
                        
                        .sm-servers-grid.list-view .sm-server-card {
                            flex-direction: column;
                            align-items: stretch;
                        }
                        
                        .sm-servers-grid.list-view .sm-server-stats {
                            background: #f9fafb;
                            padding: 12px;
                            border-radius: 10px;
                        }
                        
                        .sm-servers-grid.list-view .sm-joined-date {
                            display: block;
                        }
                    }
                </style>
                
                <div class="sm-header">
                    <div class="sm-header-left">
                        <h2>
                            <span>🏠</span>
                            Server Management
                        </h2>
                        <span class="sm-badge">
                            <span>🔒</span>
                            Admin Panel
                        </span>
                    </div>
                    <div class="sm-view-toggle">
                        <button class="sm-view-btn active" onclick="toggleServerView(event, 'grid')" title="Grid View">
                            ⊞
                        </button>
                        <button class="sm-view-btn" onclick="toggleServerView(event, 'list')" title="List View">
                            ☰
                        </button>
                    </div>
                </div>
                
                <div class="sm-stats-grid">
                    <div class="sm-stat-card">
                        <div class="sm-stat-icon">🏢</div>
                        <div class="sm-stat-info">
                            <div class="sm-stat-value">${totalServers}</div>
                            <div class="sm-stat-label">Total Servers</div>
                        </div>
                    </div>
                    <div class="sm-stat-card">
                        <div class="sm-stat-icon">👥</div>
                        <div class="sm-stat-info">
                            <div class="sm-stat-value">${totalMembers.toLocaleString()}</div>
                            <div class="sm-stat-label">Total Members</div>
                        </div>
                    </div>
                    <div class="sm-stat-card">
                        <div class="sm-stat-icon">📊</div>
                        <div class="sm-stat-info">
                            <div class="sm-stat-value">${avgMembers}</div>
                            <div class="sm-stat-label">Avg Members/Server</div>
                        </div>
                    </div>
                </div>
                
                <div class="sm-search-bar">
                    <input 
                        type="text" 
                        class="sm-search-input" 
                        id="serverSearchInput" 
                        placeholder="🔍 Search servers by name or ID..."
                        onkeyup="filterServerCards()"
                    />
                    <select class="sm-sort-select" id="serverSortSelect" onchange="sortServerCards()">
                        <option value="members-desc">Members (High to Low)</option>
                        <option value="members-asc">Members (Low to High)</option>
                        <option value="name-asc">Name (A-Z)</option>
                        <option value="name-desc">Name (Z-A)</option>
                        <option value="joined-desc">Recently Joined</option>
                        <option value="joined-asc">Oldest First</option>
                    </select>
                </div>
                
                <div class="sm-servers-grid" id="serversGrid">
                    ${servers.length > 0 ? servers.map(server => {
                        const serverName = server.name || 'Unknown Server';
                        
                        return `
                        <div class="sm-server-card" data-server-id="${server.id}" data-server-name="${serverName.toLowerCase()}" data-member-count="${server.memberCount}" data-joined="${server.joinedAt.getTime()}" style="cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onclick="viewServerMembers('${server.id}', '${serverName.replace(/'/g, "\\'")}')">
                            <div class="sm-server-header">
                                <div class="sm-server-info" style="margin-left: 0;">
                                    <div class="sm-server-name" title="${serverName}">${serverName}</div>
                                    <div class="sm-server-id">ID: ${server.id}</div>
                                </div>
                            </div>
                            
                            <div class="sm-server-stats">
                                <div class="sm-stat-item">
                                    <div class="sm-stat-item-value">${server.memberCount.toLocaleString()}</div>
                                    <div class="sm-stat-item-label">Members</div>
                                </div>
                                <div class="sm-stat-item">
                                    <div class="sm-stat-item-value">${new Date(server.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                    <div class="sm-stat-item-label">Joined</div>
                                </div>
                            </div>
                            
                            <div class="sm-joined-date">
                                📅 Joined: ${new Date(server.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                            
                            <div class="sm-server-actions">
                                <button class="sm-btn sm-btn-info" onclick="event.stopPropagation(); copyServerId('${server.id}')">
                                    📋 Copy ID
                                </button>
                                <button class="sm-btn sm-btn-leave" onclick="event.stopPropagation(); leaveServer('${server.id}', '${serverName.replace(/'/g, "\\'")}')">

                                    🚪 Leave Server
                                </button>
                            </div>
                        </div>
                        `;
                    }).join('') : `
                        <div class="sm-empty">
                            <div class="sm-empty-icon">🏜️</div>
                            <h3>No Servers Found</h3>
                            <p>The bot hasn't joined any servers yet.</p>
                        </div>
                    `}
                </div>
                
                <script>
                    function filterServerCards() {
                        const searchInput = document.getElementById('serverSearchInput');
                        const filter = searchInput.value.toLowerCase();
                        const cards = document.querySelectorAll('.sm-server-card');
                        
                        cards.forEach(card => {
                            const serverName = card.dataset.serverName;
                            const serverId = card.dataset.serverId;
                            
                            if (serverName.includes(filter) || serverId.includes(filter)) {
                                card.style.display = 'flex';
                            } else {
                                card.style.display = 'none';
                            }
                        });
                    }
                    
                    function sortServerCards() {
                        const sortSelect = document.getElementById('serverSortSelect');
                        const sortValue = sortSelect.value;
                        const grid = document.getElementById('serversGrid');
                        const cards = Array.from(document.querySelectorAll('.sm-server-card'));
                        
                        // Save selected sort option to localStorage
                        localStorage.setItem('serverSortOption', sortValue);
                        
                        cards.sort((a, b) => {
                            switch(sortValue) {
                                case 'members-desc':
                                    return parseInt(b.dataset.memberCount) - parseInt(a.dataset.memberCount);
                                case 'members-asc':
                                    return parseInt(a.dataset.memberCount) - parseInt(b.dataset.memberCount);
                                case 'name-asc':
                                    return a.dataset.serverName.localeCompare(b.dataset.serverName);
                                case 'name-desc':
                                    return b.dataset.serverName.localeCompare(a.dataset.serverName);
                                case 'joined-desc':
                                    return parseInt(b.dataset.joined) - parseInt(a.dataset.joined);
                                case 'joined-asc':
                                    return parseInt(a.dataset.joined) - parseInt(b.dataset.joined);
                                default:
                                    return 0;
                            }
                        });
                        
                        cards.forEach(card => grid.appendChild(card));
                    }
                    
                    async function copyServerId(serverId) {
                        try {
                            await navigator.clipboard.writeText(serverId);
                            if (typeof showNotification === 'function') {
                                showNotification('Server ID copied to clipboard!', 'success');
                            } else {
                                alert('Server ID copied: ' + serverId);
                            }
                        } catch (err) {
                            console.error('Failed to copy:', err);
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = serverId;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            alert('Server ID copied: ' + serverId);
                        }
                    }
                    
                    function showMemberModal(serverName, serverId, members) {
                        const modal = document.createElement('div');
                        modal.id = 'memberModal';
                        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px);';
                        
                        const modalContent = document.createElement('div');
                        modalContent.style.cssText = 'background: #fff; border-radius: 16px; width: 100%; max-width: 900px; max-height: 85vh; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column;';
                        
                        const memberHTML = members.length === 0 ? '<div style="text-align: center; padding: 60px 20px; color: #64748b;"><div style="font-size: 48px; margin-bottom: 16px;">👥</div><h3 style="margin: 0 0 8px 0; color: #1e293b;">No Members Found</h3><p style="margin: 0;">Unable to fetch members for this server.</p></div>' : '<div style="display: grid; gap: 12px;">' + members.map((member, index) => '<div class="member-card" data-username="' + (member.username || '').toLowerCase() + '" data-displayname="' + (member.displayName || '').toLowerCase() + '" data-id="' + member.id + '" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 16px; transition: all 0.2s;" onmouseover="this.style.background=\'#f1f5f9\'; this.style.borderColor=\'#cbd5e1\';" onmouseout="this.style.background=\'#f8fafc\'; this.style.borderColor=\'#e2e8f0\';"><div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, ' + ['#667eea', '#f093fb', '#4facfe', '#43e97b', '#fa709a'][index % 5] + ', ' + ['#764ba2', '#f5576c', '#00f2fe', '#38f9d7', '#fee140'][index % 5] + '); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 18px; flex-shrink: 0;">' + (member.displayName || member.username || '?').charAt(0).toUpperCase() + '</div><div style="flex: 1; min-width: 0;"><div style="font-weight: 600; font-size: 15px; color: #1e293b; margin-bottom: 4px;">' + (member.displayName || member.username || 'Unknown User') + '</div><div style="font-size: 13px; color: #64748b;">@' + (member.username || 'unknown') + '</div><div style="font-size: 12px; color: #94a3b8; font-family: monospace; margin-top: 2px;">ID: ' + member.id + '</div></div><div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">' + (member.isBot ? '<span style="background: #dbeafe; color: #1e40af; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;">🤖 BOT</span>' : '') + (member.joinedAt ? '<span style="font-size: 12px; color: #64748b;">Joined: ' + new Date(member.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</span>' : '') + '</div></div>').join('') + '</div>';
                        
                        modalContent.innerHTML = '<div style="padding: 24px; border-bottom: 1px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;"><div style="display: flex; justify-content: space-between; align-items: center;"><div><h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700;">' + serverName + '</h2><p style="margin: 0; opacity: 0.9; font-size: 14px;">Server ID: ' + serverId + ' • ' + members.length + ' members</p></div><button onclick="closeMemberModal()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 20px; line-height: 1; transition: background 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.3)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.2)\'">✕</button></div><div style="margin-top: 16px;"><input type="text" id="memberModalSearch" placeholder="🔍 Search members by name, display name, or ID..." onkeyup="filterModalMembers()" style="width: 100%; padding: 10px 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; font-size: 14px; background: rgba(255,255,255,0.95); outline: none;" /></div></div><div id="memberListContainer" style="flex: 1; overflow-y: auto; padding: 20px;">' + memberHTML + '</div>';
                        
                        modal.appendChild(modalContent);
                        document.body.appendChild(modal);
                        
                        modal.addEventListener('click', (e) => {
                            if (e.target === modal) {
                                closeMemberModal();
                            }
                        });
                    }
                    
                    function filterModalMembers() {
                        const searchInput = document.getElementById('memberModalSearch');
                        if (!searchInput) return;
                        
                        const filter = searchInput.value.toLowerCase();
                        const memberCards = document.querySelectorAll('.member-card');
                        
                        memberCards.forEach(card => {
                            const username = card.dataset.username || '';
                            const displayName = card.dataset.displayname || '';
                            const id = card.dataset.id || '';
                            
                            if (username.includes(filter) || displayName.includes(filter) || id.includes(filter)) {
                                card.style.display = 'flex';
                            } else {
                                card.style.display = 'none';
                            }
                        });
                    }
                    
                    function closeMemberModal() {
                        const modal = document.getElementById('memberModal');
                        if (modal) {
                            modal.remove();
                        }
                    }
                    
                    document.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            closeMemberModal();
                        }
                    });
                    
                    function toggleServerView(evt, viewType) {
                        const grid = document.getElementById('serversGrid');
                        const buttons = document.querySelectorAll('.sm-view-btn');
                        
                        buttons.forEach(btn => btn.classList.remove('active'));
                        if (evt && evt.target) {
                            evt.target.classList.add('active');
                        }
                        
                        if (viewType === 'list') {
                            grid.classList.add('list-view');
                            localStorage.setItem('serverViewType', 'list');
                        } else {
                            grid.classList.remove('list-view');
                            localStorage.setItem('serverViewType', 'grid');
                        }
                    }
                    
                    // Restore saved view preference and sort option
                    window.addEventListener('DOMContentLoaded', function() {
                        // Restore view type
                        const savedView = localStorage.getItem('serverViewType');
                        if (savedView === 'list') {
                            const grid = document.getElementById('serversGrid');
                            const listBtn = document.querySelector('.sm-view-btn:last-child');
                            const gridBtn = document.querySelector('.sm-view-btn:first-child');
                            if (grid && listBtn && gridBtn) {
                                grid.classList.add('list-view');
                                gridBtn.classList.remove('active');
                                listBtn.classList.add('active');
                            }
                        }
                        
                        // Restore sort option
                        const savedSort = localStorage.getItem('serverSortOption');
                        if (savedSort) {
                            const sortSelect = document.getElementById('serverSortSelect');
                            if (sortSelect) {
                                sortSelect.value = savedSort;
                                sortServerCards();
                            }
                        }
                    });
                    
                    async function viewServerMembers(serverId, serverName) {
                        try {
                            if (typeof showNotification === 'function') {
                                showNotification('Loading server members...', 'info');
                            }
                            
                            const response = await fetch('/admin/servers/' + serverId + '/members', {
                                method: 'GET',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            
                            const data = await response.json();
                            
                            if (data.success && data.members) {
                                showMemberModal(serverName, serverId, data.members);
                            } else {
                                if (typeof showNotification === 'function') {
                                    showNotification('Failed to load members: ' + (data.message || 'Unknown error'), 'error');
                                } else {
                                    alert('Failed to load members: ' + (data.message || 'Unknown error'));
                                }
                            }
                        } catch (error) {
                            console.error('Error fetching server members:', error);
                            if (typeof showNotification === 'function') {
                                showNotification('Error: ' + error.message, 'error');
                            } else {
                                alert('Error loading members: ' + error.message);
                            }
                        }
                    }
                    
                    async function leaveServer(serverId, serverName) {
                        const confirmed = confirm(
                            'WARNING: Are you sure you want to leave "' + serverName + '"?\\n\\n' +
                            'Server ID: ' + serverId + '\\n\\n' +
                            'This action cannot be undone. The bot will immediately leave this server.'
                        );
                        
                        if (!confirmed) return;
                        
                        try {
                            const response = await fetch('/admin/servers/leave', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ serverId })
                            });
                            
                            const data = await response.json();
                            
                            if (data.success) {
                                if (typeof showNotification === 'function') {
                                    showNotification('Successfully left "' + serverName + '"', 'success');
                                } else {
                                    alert('Successfully left "' + serverName + '"');
                                }
                                
                                // Remove the card from the UI
                                const card = document.querySelector('[data-server-id="' + serverId + '"]');
                                if (card) {
                                    card.style.opacity = '0';
                                    card.style.transform = 'scale(0.9)';
                                    setTimeout(() => card.remove(), 300);
                                }
                                
                                // Update stats
                                setTimeout(() => location.reload(), 1000);
                            } else {
                                if (typeof showNotification === 'function') {
                                    showNotification('Failed to leave server: ' + (data.message || 'Unknown error'), 'error');
                                } else {
                                    alert('Failed to leave server: ' + (data.message || 'Unknown error'));
                                }
                            }
                        } catch (error) {
                            console.error('Error leaving server:', error);
                            if (typeof showNotification === 'function') {
                                showNotification('Error: ' + error.message, 'error');
                            } else {
                                alert('Error leaving server: ' + error.message);
                            }
                        }
                    }
                </script>
            </div>
        `;
    } catch (error) {
        console.error('Error generating server management content:', error);
        return `
            <div class="error-message">
                <h3>❌ Error Loading Server Management</h3>
                <p>There was an error loading the server management interface.</p>
                <p style="color: #666; font-size: 14px;">Error: ${error.message}</p>
            </div>
        `;
    }
}

/**
 * Generates the HTML for the admin dashboard with tab-based navigation.
 * @param {Object} analytics - The analytics data for the dashboard.
 * @param {Object} client - The Discord client instance.
 * @returns {Promise<string>} The HTML content for the dashboard.
 */
async function generateDashboard(analytics, client) {
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
        :root {
            --bg: #f8fafc;
            --bg-alt: #f1f5f9;
            --surface: #ffffff;
            --surface-soft: #f8fafc;
            --surface-elevated: #ffffff;
            --border-subtle: #e2e8f0;
            --primary: #6366f1;
            --primary-soft: rgba(99, 102, 241, 0.1);
            --accent: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text: #1e293b;
            --text-muted: #64748b;
            --card-radius: 14px;
            --shadow-soft: 0 10px 40px rgba(15, 23, 42, 0.08);
            --shadow-subtle: 0 4px 20px rgba(15, 23, 42, 0.05);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background:
                radial-gradient(900px 500px at 5% 0%, rgba(99, 102, 241, 0.06), transparent 60%),
                radial-gradient(900px 600px at 100% 0%, rgba(139, 92, 246, 0.08), transparent 60%),
                radial-gradient(1200px 800px at 50% 110%, rgba(99, 102, 241, 0.04), transparent 60%),
                var(--bg);
            color: var(--text);
            line-height: 1.6;
            min-height: 100vh;
        }

        .header {
            position: sticky;
            top: 0;
            z-index: 20;
            backdrop-filter: blur(18px);
            background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98));
            border-bottom: 1px solid var(--border-subtle);
            box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
            padding: 12px 0;
        }

        .header-inner {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
        }

        .header-main {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header-logo {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            display: grid;
            place-items: center;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
            font-size: 18px;
            flex-shrink: 0;
        }

        .header-title-wrap {
            display: flex;
            flex-direction: column;
            gap: 1px;
        }

        .header-title {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.01em;
            color: var(--text);
            line-height: 1.2;
        }

        .header-subtitle {
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.2;
        }

        .header-pill-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .header-pill {
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            background: var(--surface);
            border: 1px solid var(--border-subtle);
            color: var(--text-muted);
            font-weight: 600;
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .logout-btn {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.20);
            transition: transform 0.08s ease, box-shadow 0.12s ease, filter 0.12s ease;
            white-space: nowrap;
        }

        .logout-btn:hover {
            filter: brightness(1.05);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.30);
        }

        .logout-btn span.icon {
            font-size: 14px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 24px 20px 36px;
        }

        .refresh-info {
            color: var(--text-muted);
            font-size: 12px;
            margin-bottom: 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
        }

        .refresh-info span.label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .refresh-dot {
            width: 6px;
            height: 6px;
            border-radius: 999px;
            background: #22c55e;
            box-shadow: 0 0 0 4px rgba(34,197,94,0.3);
        }

        .refresh-btn {
            background: radial-gradient(circle at 0% 0%, #22c55e, #16a34a 60%);
            color: white;
            border: none;
            padding: 7px 14px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 10px 24px rgba(22,163,74,0.50);
            transition: transform 0.08s ease, box-shadow 0.12s ease, filter 0.12s ease;
        }

        .refresh-btn:hover {
            filter: brightness(1.05);
            transform: translateY(1px);
            box-shadow: 0 6px 18px rgba(22,163,74,0.40);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 18px;
            margin-bottom: 26px;
        }

        .stat-card {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.95));
            border-radius: var(--card-radius);
            padding: 16px 18px;
            border: 1px solid var(--border-subtle);
            box-shadow: var(--shadow-soft);
            position: relative;
            overflow: hidden;
            transition: transform 0.14s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }

        .stat-card::after {
            content: '';
            position: absolute;
            inset: auto -40px -40px auto;
            width: 120px;
            height: 120px;
            border-radius: 999px;
            background: radial-gradient(circle at 0% 0%, rgba(99, 102, 241, 0.05), transparent 60%);
            opacity: 0.8;
        }

        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
            border-color: rgba(99, 102, 241, 0.5);
        }

        .stat-card.premium { border-color: rgba(239, 68, 68, 0.4); }
        .stat-card.success { border-color: rgba(34, 197, 94, 0.4); }
        .stat-card.warning { border-color: rgba(245, 158, 11, 0.4); }

        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .stat-pill {
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 999px;
            border: 1px solid var(--border-subtle);
            color: var(--text-muted);
            background: var(--surface-soft);
            font-weight: 600;
        }

        .stat-card h3 {
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.03em;
            text-transform: uppercase;
            color: var(--text-muted);
        }

        .stat-value {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 2px;
            color: var(--text);
        }

        .stat-label {
            color: var(--text-muted);
            font-size: 12px;
        }

        .metric-small {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 6px;
        }

        .section {
            background: var(--surface);
            border-radius: var(--card-radius);
            padding: 18px 18px 20px;
            border: 1px solid var(--border-subtle);
            box-shadow: var(--shadow-subtle);
            margin-bottom: 20px;
        }

        .section h2 {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--border-subtle);
            color: var(--text);
        }

        .table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        .table th, .table td {
            padding: 9px 10px;
            text-align: left;
            border-bottom: 1px solid var(--border-subtle);
        }

        .table th {
            background: var(--surface-soft);
            font-weight: 600;
            color: var(--text);
        }

        .table tbody tr:nth-child(even) {
            background: var(--surface-soft);
        }

        .table tbody tr:nth-child(odd) {
            background: var(--surface);
        }

        .grid-2 {
            display: grid;
            grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
            gap: 18px;
            margin-bottom: 20px;
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--surface-soft);
            border-radius: 999px;
            overflow: hidden;
            margin-top: 5px;
            border: 1px solid var(--border-subtle);
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #22c55e);
            border-radius: 999px;
            transition: width 0.3s ease;
        }

        .tab-container {
            background: var(--surface);
            border-radius: var(--card-radius);
            box-shadow: var(--shadow-subtle);
            margin-bottom: 22px;
            border: 1px solid var(--border-subtle);
            overflow: hidden;
        }

        .tab-nav {
            display: flex;
            background: var(--surface-soft);
            border-bottom: 1px solid var(--border-subtle);
        }

        .tab-btn {
            flex: 1;
            padding: 12px 14px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            color: var(--text-muted);
            transition: background 0.18s ease, color 0.18s ease;
        }

        .tab-btn.active {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #ffffff;
        }

        .tab-btn:hover:not(.active) {
            background: rgba(99, 102, 241, 0.1);
            color: var(--text);
        }

        .tab-content {
            padding: 18px;
        }

        .tab-pane { display: none; }
        .tab-pane.active { display: block; }

        .message-form {
            background: var(--surface);
            padding: 18px 18px 16px;
            border-radius: 12px;
            border: 1px solid var(--border-subtle);
            margin-bottom: 18px;
        }

        .schedule-options {
            display: flex;
            flex-wrap: wrap;
            gap: 18px;
            margin-top: 10px;
        }

        .schedule-options .form-group {
            flex: 1 1 200px;
            min-width: 180px;
        }

        .form-group {
            margin-bottom: 14px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            font-size: 12px;
            color: var(--text);
        }

        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 9px 10px;
            border-radius: 10px;
            border: 1px solid var(--border-subtle);
            background: var(--surface);
            color: var(--text);
            font-size: 13px;
            transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .form-group textarea {
            resize: vertical;
            min-height: 90px;
        }

        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            background: var(--surface);
        }

        .char-counter {
            text-align: right;
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 3px;
        }

        .message-preview {
            background: var(--surface);
            border-radius: 12px;
            padding: 14px;
            margin: 16px 0;
            border: 1px solid var(--border-subtle);
        }

        .embed-preview {
            border-radius: 12px;
            padding: 12px 12px 10px;
            background: var(--surface-soft);
            border: 1px solid #6366f1;
        }

        .embed-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 6px;
            color: var(--text);
        }

        .embed-description {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.45;
            margin-bottom: 8px;
            white-space: pre-wrap;
        }

        .embed-footer {
            font-size: 11px;
            color: var(--text-muted);
            border-top: 1px dashed var(--border-subtle);
            padding-top: 6px;
        }

        .button-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .btn-preview,
        .btn-send,
        .btn-test {
            padding: 10px 16px;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: transform 0.08s ease, box-shadow 0.15s ease, filter 0.12s ease;
        }

        .btn-preview {
            background: linear-gradient(135deg, #38bdf8, #0ea5e9);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(14, 165, 233, 0.30);
        }

        .btn-send {
            background: linear-gradient(135deg, #a855f7, #6366f1);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.30);
        }

        .btn-test {
            background: linear-gradient(135deg, #f97316, #f59e0b);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.30);
        }

        .btn-preview:hover,
        .btn-send:hover,
        .btn-test:hover {
            filter: brightness(1.05);
            transform: translateY(-1px);
        }

        .progress-section {
            background: var(--surface);
            padding: 16px 16px 14px;
            border-radius: 12px;
            border: 1px solid var(--border-subtle);
        }

        .delivery-results {
            margin-top: 12px;
        }

        .delivery-item {
            padding: 8px 10px;
            margin: 4px 0;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
        }

        .delivery-success {
            background: rgba(34, 197, 94, 0.1);
            border: 1px solid rgba(34, 197, 94, 0.3);
            color: #22c55e;
        }

        .delivery-error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #ef4444;
        }

        /* Message Feedback Styles */
        .message-item {
            background: var(--surface);
            border-radius: 12px;
            padding: 14px 14px 12px;
            margin-bottom: 12px;
            box-shadow: var(--shadow-subtle);
            cursor: pointer;
            border: 1px solid var(--border-subtle);
            transition: border-color 0.16s ease, box-shadow 0.18s ease, transform 0.08s ease;
        }

        .message-item:hover {
            transform: translateY(-1px);
            border-color: #6366f1;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        }

        .message-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
        }

        .message-preview {
            color: var(--text-muted);
            margin-top: 6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 12px;
        }

        .feedback-stats {
            display: flex;
            gap: 12px;
            font-size: 12px;
        }

        .feedback-stat {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--text-muted);
        }

        .feedback-dot-up { color: #22c55e; }
        .feedback-dot-down { color: #ef4444; }

        .feedback-details {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.26s ease;
        }

        .message-item.expanded .feedback-details {
            max-height: 1000px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px dashed var(--border-subtle);
        }

        .comment-item {
            padding: 9px 10px;
            margin: 8px 0;
            background: var(--surface-soft);
            border-radius: 8px;
            border: 1px solid var(--border-subtle);
            font-size: 12px;
            color: var(--text);
        }

        .comment-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-bottom: 4px;
            color: var(--text-muted);
        }

        .comment-user {
            font-weight: 600;
        }

        .comment-time {
            opacity: 0.85;
        }

        @media (max-width: 1024px) {
            .grid-2 { grid-template-columns: 1fr; }
        }

        @media (max-width: 768px) {
            .header-inner { 
                flex-direction: row;
                flex-wrap: wrap;
            }
            
            .header-title {
                font-size: 16px;
            }
            
            .header-subtitle {
                font-size: 11px;
            }
            
            .logout-btn {
                padding: 6px 12px;
                font-size: 12px;
            }
            
            .stats-grid { 
                grid-template-columns: 1fr; 
            }
        }
        
        @media (max-width: 480px) {
            .header-inner {
                padding: 0 16px;
            }
            
            .header-logo {
                width: 32px;
                height: 32px;
                font-size: 16px;
            }
            
            .header-title {
                font-size: 14px;
            }
            
            .header-subtitle {
                display: none;
            }
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script>
        function manualRefresh() {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab) {
                const tabName = activeTab.onclick.toString().match(/switchTab\\('([^']+)'\\)/)[1];
                sessionStorage.setItem('activeTab', tabName);
            }
            window.location.reload();
        }
        
        function switchTab(tabName) {            
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

        function loadAutoSetupServers() {
            const select = document.getElementById('autoSetupServerSelect');
            const status = document.getElementById('autoSetupStatus');
            if (!select) return;

            select.innerHTML = '<option value="">Loading servers...</option>';
            if (status) {
                status.textContent = 'Loading server list…';
                status.style.color = '#6b7280';
            }

            fetch('/admin/servers')
                .then(response => response.json())
                .then(servers => {
                    if (!Array.isArray(servers) || servers.length === 0) {
                        select.innerHTML = '<option value="">No servers available</option>';
                        if (status) {
                            status.textContent = 'No servers available to target right now.';
                            status.style.color = '#d97706';
                        }
                        return;
                    }

                    servers.sort((a, b) => a.name.localeCompare(b.name));
                    const optionMarkup = servers.map(server => '<option value="' + server.id + '">' + server.name + ' (' + server.memberCount + ' members)</option>');
                    select.innerHTML = ['<option value="">Select a server…</option>', ...optionMarkup].join('');

                    if (status) {
                        status.textContent = 'Pick a server and send the Auto Setup walkthrough.';
                        status.style.color = '#6b7280';
                    }
                })
                .catch(error => {
                    select.innerHTML = '<option value="">Failed to load servers</option>';
                    if (status) {
                        status.textContent = 'Error loading servers: ' + error.message;
                        status.style.color = '#dc2626';
                    }
                });
        }

        async function sendAutoSetupMessage(sendAll = false) {
            const select = document.getElementById('autoSetupServerSelect');
            const status = document.getElementById('autoSetupStatus');
            const button = document.getElementById('autoSetupSendBtn');
            const allButton = document.getElementById('autoSetupSendAllBtn');

            if (!sendAll && (!select || !select.value)) {
                alert('Please choose a server to send the Auto Setup message to.');
                return;
            }

            if (sendAll && !confirm('Send the Auto Setup packet to ALL servers? This will post onboarding embeds in every guild where the bot has permission.')) {
                return;
            }

            const serverId = select ? select.value : null;

            if (button) {
                button.disabled = true;
                button.textContent = 'Sending…';
            }
            if (allButton) {
                allButton.disabled = true;
                allButton.textContent = 'Sending…';
            }
            if (status) {
                status.textContent = sendAll ? 'Broadcasting Auto Setup packet to all servers…' : 'Sending Auto Setup packet…';
                status.style.color = '#2563eb';
            }

            try {
                const response = await fetch('/admin/send-auto-setup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(sendAll ? { sendAll: true } : { serverId })
                });

                const result = await response.json().catch(() => ({}));

                if (response.ok && result.success) {
                    if (status) {
                        status.textContent = sendAll
                            ? 'Delivered Auto Setup packet to ' + result.delivered + ' / ' + result.total + ' servers.'
                            : 'Auto Setup message delivered successfully!';
                        status.style.color = '#10b981';
                    }
                } else {
                    const message = result.message || 'Unknown error';
                    if (status) {
                        status.textContent = 'Failed to send Auto Setup message: ' + message;
                        status.style.color = '#dc2626';
                    }
                    alert('Failed to send Auto Setup message: ' + message);
                }
            } catch (error) {
                if (status) {
                    status.textContent = 'Error sending Auto Setup message: ' + error.message;
                    status.style.color = '#dc2626';
                }
                alert('Error sending Auto Setup message: ' + error.message);
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = '🚀 Send Auto Setup Packet';
                }
                if (allButton) {
                    allButton.disabled = false;
                    allButton.textContent = '🌐 Send to All Servers';
                }
            }
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

            loadAutoSetupServers();
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
    
    // Auto-update global statistics every 30 seconds
    function updateGlobalStats() {
        // Only update if we're on the monetization tab
        const monetizationTab = document.getElementById('monetization');
        if (monetizationTab && monetizationTab.classList.contains('active')) {
            // Force a page reload to get fresh data
            // In a more sophisticated implementation, you could fetch only the stats via AJAX
            const currentTime = Date.now();
            const lastUpdate = sessionStorage.getItem('lastStatsUpdate');
            
            // Only update if it's been more than 30 seconds
            if (!lastUpdate || (currentTime - parseInt(lastUpdate)) > 30000) {
                sessionStorage.setItem('lastStatsUpdate', currentTime.toString());
                // You could implement a more efficient AJAX update here
                console.log('📊 Global statistics would be updated here');
            }
        }
    }
    
    // Update stats every 30 seconds
    setInterval(updateGlobalStats, 30000);
    
    // Monetization Functions
    async function saveGlobalSettings() {
        const freeLimit = document.getElementById('freeLimit').value;
        const globalRestriction = document.getElementById('globalRestriction').checked;
        
        try {
            const response = await fetch('/admin/monetization/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    defaultFreeTranslationLimit: parseInt(freeLimit),
                    enableGlobalRestriction: globalRestriction
                })
            });
            
            if (response.ok) {
                showNotification('Global settings saved successfully!', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to save settings', 'error');
            }
        } catch (error) {
            showNotification('Error saving settings: ' + error.message, 'error');
        }
    }
    
    async function addExemptServer(serverId = null) {
        const id = serverId || document.getElementById('serverIdInput').value.trim();
        if (!id) {
            showNotification('Please enter a server ID', 'error');
            return;
        }
        
        try {
            const response = await fetch('/admin/monetization/exempt/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId: id })
            });
            
            if (response.ok) {
                showNotification('Server added to exempt list', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to add server to exempt list', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    }
    
    async function addRestrictedServer(serverId = null) {
        const id = serverId || document.getElementById('serverIdInput').value.trim();
        if (!id) {
            showNotification('Please enter a server ID', 'error');
            return;
        }
        
        try {
            const response = await fetch('/admin/monetization/restrict/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId: id })
            });
            
            if (response.ok) {
                showNotification('Server added to restricted list', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to add server to restricted list', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    }
    
    async function removeExemptServer(serverId) {
        try {
            const response = await fetch('/admin/monetization/exempt/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId })
            });
            
            if (response.ok) {
                showNotification('Server removed from exempt list', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to remove server from exempt list', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    }
    
    async function removeRestrictedServer(serverId) {
        try {
            const response = await fetch('/admin/monetization/restrict/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId })
            });
            
            if (response.ok) {
                showNotification('Server removed from restricted list', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to remove server from restricted list', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    }
    
    async function resetServerCount(serverId = null) {
        const id = serverId || document.getElementById('serverIdInput').value.trim();
        if (!id) {
            showNotification('Please enter a server ID', 'error');
            return;
        }
        
        if (!confirm('Are you sure you want to reset the translation count for this server?')) {
            return;
        }
        
        try {
            const response = await fetch('/admin/monetization/reset-count', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId: id })
            });
            
            if (response.ok) {
                showNotification('Translation count reset successfully', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to reset translation count', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    }
    
    async function setCustomLimit() {
        const serverId = document.getElementById('serverIdInput').value.trim();
        const customLimit = document.getElementById('customLimitInput').value.trim();
        
        if (!serverId) {
            showNotification('Please enter a server ID', 'error');
            return;
        }
        
        if (!customLimit || customLimit < 1) {
            showNotification('Please enter a valid limit (minimum 1)', 'error');
            return;
        }
        
        try {
            const response = await fetch('/admin/monetization/custom-limit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    serverId: serverId,
                    customLimit: parseInt(customLimit)
                })
            });
            
            if (response.ok) {
                showNotification('Custom limit of ' + customLimit + ' set for server', 'success');
                document.getElementById('customLimitInput').value = '';
                setTimeout(() => location.reload(), 1000);
            } else {
                showNotification('Failed to set custom limit', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    }
    
    // Bulk Action Functions
    async function bulkRestrictAll() {
        if (!confirm('WARNING: This will apply restrictions to ALL servers that are not currently exempted. Are you sure you want to continue?')) {
            return;
        }
        
        try {
            showNotification('Applying restrictions to all servers...', 'info');
            const response = await fetch('/admin/monetization/bulk/restrict-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            
            const data = await response.json();
            if (data.success) {
                showNotification('Successfully restricted ' + (data.affectedCount || 0) + ' servers', 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                showNotification('Failed to apply bulk restrictions: ' + (data.message || 'Unknown error'), 'error');
            }
        } catch (error) {
            showNotification('Error applying bulk restrictions: ' + error.message, 'error');
        }
    }
    
    async function bulkRemoveRestrictions() {
        if (!confirm('This will remove restrictions from ALL servers (exempted servers will remain exempted). Continue?')) {
            return;
        }
        
        try {
            showNotification('Removing all restrictions...', 'info');
            const response = await fetch('/admin/monetization/bulk/remove-restrictions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            
            const data = await response.json();
            if (data.success) {
                showNotification('Successfully removed restrictions from ' + (data.affectedCount || 0) + ' servers', 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                showNotification('Failed to remove bulk restrictions: ' + (data.message || 'Unknown error'), 'error');
            }
        } catch (error) {
            showNotification('Error removing bulk restrictions: ' + error.message, 'error');
        }
    }
    
    async function bulkResetCounts() {
        if (!confirm('WARNING: This will reset translation counts to 0 for ALL servers. This action cannot be undone. Continue?')) {
            return;
        }
        
        try {
            showNotification('Resetting all translation counts...', 'info');
            const response = await fetch('/admin/monetization/bulk/reset-counts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            
            const data = await response.json();
            if (data.success) {
                showNotification('Successfully reset counts for ' + (data.affectedCount || 0) + ' servers', 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                showNotification('Failed to reset counts: ' + (data.message || 'Unknown error'), 'error');
            }
        } catch (error) {
            showNotification('Error resetting counts: ' + error.message, 'error');
        }
    }
    
    function searchMonetizationServers() {
        const searchInput = document.getElementById('monetizationSearchInput');
        const filter = searchInput.value.toLowerCase();
        const rows = document.querySelectorAll('.server-row');
        
        rows.forEach(row => {
            const serverName = row.querySelector('.server-name')?.textContent.toLowerCase() || '';
            const serverId = row.querySelector('.server-id')?.textContent.toLowerCase() || '';
            const members = row.querySelector('.member-count')?.textContent.toLowerCase() || '';
            const translations = row.querySelector('.translation-count')?.textContent.toLowerCase() || '';
            
            const matchesSearch = serverName.includes(filter) || 
                                serverId.includes(filter) || 
                                members.includes(filter) || 
                                translations.includes(filter);
            
            if (matchesSearch) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }
    
    function filterServers(type) {
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        // Clear search input when filtering
        const searchInput = document.getElementById('monetizationSearchInput');
        if (searchInput) searchInput.value = '';
        
        const rows = document.querySelectorAll('.server-row');
        rows.forEach(row => {
            const status = row.dataset.status;
            let show = false;
            
            switch(type) {
                case 'all':
                    show = true;
                    break;
                case 'restricted':
                    show = status === 'restricted';
                    break;
                case 'exempt':
                    show = status === 'exempt';
                    break;
                case 'over-limit':
                    show = status === 'over-limit';
                    break;
            }
            
            row.style.display = show ? 'table-row' : 'none';
        });
    }
    
    function showNotification(message, type = 'info') {
        // Remove existing notifications
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = \`notification notification-\${type}\`;
        notification.textContent = message;
        
        // Add styles
        notification.style.cssText = \`
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            background: \${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#667eea'};
            transform: translateX(100%);
            transition: transform 0.3s ease;
        \`;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => notification.style.transform = 'translateX(0)', 100);
        
        // Remove after 4 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
    
    // Helper: copy text to clipboard with graceful fallback
    function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text)
                    .then(() => showNotification('Copied to clipboard', 'success'))
                    .catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
        } catch (e) {
            fallbackCopy(text);
        }
        
        function fallbackCopy(t) {
            const temp = document.createElement('textarea');
            temp.value = t;
            temp.setAttribute('readonly', '');
            temp.style.position = 'fixed';
            temp.style.left = '-9999px';
            document.body.appendChild(temp);
            temp.focus();
            temp.select();
            try {
                document.execCommand('copy');
                showNotification('Copied to clipboard', 'success');
            } catch (err) {
                alert('Copy failed');
            }
            document.body.removeChild(temp);
        }
    }
</script>
</head>
<body>
    <div class="header">
        <div class="header-inner">
            <div class="header-main">
                <div class="header-logo">🤖</div>
                <div class="header-title-wrap">
                    <div class="header-title">AirTranslator Admin Dashboard</div>
                    <div class="header-subtitle">Complete Analytics & Server Management</div>
                </div>
            </div>
            <a href="/admin/logout" class="logout-btn">
                <span class="icon">🚪</span>
                Logout
            </a>
        </div>
    </div>
    
    <div class="container">
        <div class="refresh-info">
            <span>Last updated: ${new Date().toLocaleString()}</span>
            <button class="refresh-btn" onclick="manualRefresh()">🔄 Refresh Now</button>
        </div>
        
        <div class="tab-container">
            <div class="tab-nav">
                <button class="tab-btn active" onclick="switchTab('analytics')">📊 Analytics</button>
                <button class="tab-btn" onclick="switchTab('messaging')">📢 Server Messaging</button>
                <button class="tab-btn" onclick="switchTab('monetization')">💰 Monetization</button>
                <button class="tab-btn" onclick="switchTab('servers')">🏠 Server Management</button>
                <button class="tab-btn" onclick="switchTab('feedback')">📊 Feedback</button>
            </div>
            
            <div class="tab-content">
                <div id="analytics" class="tab-pane active">
                    
                    ${generateAnalyticsContent(analytics, client)}
                    
                </div>
                
                <div id="messaging" class="tab-pane">
                    ${generateMessageInterface()}
                </div>
                
                <div id="monetization" class="tab-pane">
                    ${await generateMonetizationContent(client)}
                </div>
                
                <div id="servers" class="tab-pane">
                    ${await generateServerManagementContent(client)}
                </div>
                
                <div id="feedback" class="tab-pane">
                    <div class="feedback-container">
                        <style>
                            .feedback-container { color:#1f2937; }
                            .feedback-container .head { display:flex; align-items:center; justify-content: space-between; gap:12px; margin-bottom:16px; }
                            .feedback-container .title { display:flex; align-items:center; gap:10px; font-weight:800; font-size:20px; }
                            .feedback-container .subtitle { color:#6b7280; font-size:13px; margin-top:4px; }
                            .feedback-container .chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 8px; border-radius:999px; background:#eef2ff; color:#4f46e5; border:1px solid #e0e7ff; }
                            .feedback-container .grid { display:grid; grid-template-columns: 1fr; gap:20px; }
                            .feedback-container .card { background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; box-shadow: 0 8px 20px rgba(0,0,0,.04); }
                            .feedback-container .card .card-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f3f4f6; }
                            .feedback-container .card .card-body { padding:16px; }
                            .feedback-container .stats-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px; }
                            .feedback-container .stat-card { display:flex; align-items:center; gap:10px; padding:14px; border:1px solid #eef2f7; border-radius:12px; background:#fff; box-shadow:0 4px 12px rgba(0,0,0,.03); }
                            .feedback-container .stat-icon { font-size:18px; }
                            .feedback-container .stat-info { display:flex; flex-direction:column; }
                            .feedback-container .stat-value { font-weight:800; font-size:18px; color:#111827; }
                            .feedback-container .stat-label { font-size:12px; color:#6b7280; }
                            .feedback-container .message-list { display:flex; flex-direction:column; gap:12px; }
                            .feedback-container .message-item { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 12px rgba(0,0,0,.03); cursor:pointer; transition: box-shadow .2s ease, transform .04s ease; }
                            .feedback-container .message-item:hover { box-shadow:0 8px 20px rgba(0,0,0,.06); }
                            .feedback-container .message-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
                            .feedback-container .message-preview { color:#4b5563; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 60vw; }
                            .feedback-container .feedback-stats { display:flex; gap:12px; }
                            .feedback-container .feedback-stat { background:#f9fafb; border:1px solid #e5e7eb; border-radius:999px; padding:6px 10px; font-weight:700; font-size:12px; color:#374151; }
                            .feedback-container .feedback-details { max-height:0; overflow:hidden; transition:max-height .25s ease; }
                            .feedback-container .message-item.expanded .feedback-details { max-height:1000px; margin-top:12px; padding-top:12px; border-top:1px dashed #e5e7eb; }
                            .feedback-container .comment-item { padding:10px; border:1px solid #f3f4f6; border-radius:10px; background:#f9fafb; margin:8px 0; }
                            .feedback-container .comment-header { display:flex; justify-content:space-between; font-size:12px; color:#6b7280; margin-bottom:4px; }
                            .feedback-container .empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:24px; border:2px dashed #e5e7eb; border-radius:12px; color:#6b7280; background:#fafafa; }
                            @media (max-width: 980px) { .feedback-container .stats-grid { grid-template-columns: 1fr; } }
                        </style>

                        <div class="head">
                            <div>
                                <div class="title">📊 Feedback Insights</div>
                                <div class="subtitle">Review audience reactions and comments for your broadcast messages.</div>
                            </div>
                            <span class="chip">Admin • Secure</span>
                        </div>

                        <div class="grid">
                            <div class="card">
                                <div class="card-head">
                                    <div class="title">Overview</div>
                                </div>
                                <div class="card-body">
                                    <div class="stats-grid">
                                        <div class="stat-card">
                                            <div class="stat-icon">📝</div>
                                            <div class="stat-info">
                                                <div class="stat-value">${messagesWithFeedback.length}</div>
                                                <div class="stat-label">Messages With Feedback</div>
                                            </div>
                                        </div>
                                        <div class="stat-card">
                                            <div class="stat-icon">👍</div>
                                            <div class="stat-info">
                                                <div class="stat-value">${messagesWithFeedback.reduce((a,m)=>a + (m.likes||0),0)}</div>
                                                <div class="stat-label">Total Likes</div>
                                            </div>
                                        </div>
                                        <div class="stat-card">
                                            <div class="stat-icon">💬</div>
                                            <div class="stat-info">
                                                <div class="stat-value">${messagesWithFeedback.reduce((a,m)=>a + (m.comments?.length||0),0)}</div>
                                                <div class="stat-label">Total Comments</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="card">
                                <div class="card-head">
                                    <div class="title">Recent Messages</div>
                                </div>
                                <div class="card-body">
                                    ${messagesWithFeedback.length === 0 ? `
                                        <div class="empty-state">
                                            <div style="font-size:22px">🕊️</div>
                                            <div>No feedback yet</div>
                                            <div style="font-size:12px">Send a test broadcast from the Messaging tab to start collecting feedback.</div>
                                        </div>
                                    ` : `
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
                                    `}
                                </div>
                            </div>
                        </div>
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

async function sendAutoSetupPacket({ serverId = null, sendAll = false }) {
    const client = global.discordClient;
    if (!client) {
        return { success: false, message: 'Bot not ready' };
    }

    const targetGuilds = sendAll
        ? Array.from(client.guilds.cache.values())
        : [client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null)].filter(Boolean);

    if (!sendAll && targetGuilds.length === 0) {
        return { success: false, message: 'Server not found or bot not present' };
    }

    const sendResults = [];
    let delivered = 0;

    for (const guild of targetGuilds) {
        try {
            const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
            const hasSendPerms = (channel) => {
                const permsFor = channel.permissionsFor(botMember || client.user);
                return permsFor?.has(['ViewChannel', 'SendMessages', 'EmbedLinks']) ?? false;
            };

            let targetChannel = guild.channels.cache.find(ch => ch.type === 0 && ch.name.toLowerCase().includes('announce') && hasSendPerms(ch));

            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(ch => ch.type === 0 && (ch.name.toLowerCase().includes('general') || ch.name.toLowerCase().includes('chat')) && hasSendPerms(ch));
            }

            if (!targetChannel && guild.systemChannel && hasSendPerms(guild.systemChannel)) {
                targetChannel = guild.systemChannel;
            }

            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(ch => ch.type === 0 && hasSendPerms(ch));
            }

            if (!targetChannel) {
                sendResults.push({
                    success: false,
                    serverId: guild.id,
                    serverName: guild.name,
                    error: 'No suitable channel found with send permissions'
                });
                continue;
            }

            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🌍 Translation Bot Ready!')
                .setDescription('Use `/quicksetup` to configure translation between channels.')
                .addFields(
                    { name: 'Example', value: '```/quicksetup source: #english target: #spanish language: Spanish```' }
                );

            const guidedEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🧭 AutoSetup')
                .setDescription('Below is AutoSetup — just follow these quick steps:')
                .addFields(
                    { name: '1) Select channels', value: 'Pick 1–5 channels in the selector below.' },
                    { name: '2) Continue', value: 'Press "Continue" to proceed.' },
                    { name: '3) Add languages', value: 'Enter languages (e.g., Spanish, French), then submit.' }
                )
                .setFooter({ text: 'You can cancel anytime. Try /help for more.' })
                .setTimestamp();

            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('autosetup_channels')
                .setPlaceholder('Select 1-5 channels for translation')
                .setMinValues(1)
                .setMaxValues(5)
                .setChannelTypes([ChannelType.GuildText, ChannelType.GuildVoice]);

            const controlsRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('autosetup_continue').setLabel('Continue ▶').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('autosetup_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );

            const selectRow = new ActionRowBuilder().addComponents(channelSelect);

            await targetChannel.send({ embeds: [welcomeEmbed] });
            await targetChannel.send({ embeds: [guidedEmbed] });
            await targetChannel.send({ content: 'Below is AutoSetup — just follow the steps.', components: [selectRow, controlsRow] });

            sendResults.push({
                success: true,
                serverId: guild.id,
                serverName: guild.name,
                channelId: targetChannel.id,
                channelName: targetChannel.name
            });
            delivered++;
        } catch (error) {
            sendResults.push({
                success: false,
                serverId: guild.id,
                serverName: guild.name,
                error: error.message
            });
        }
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    return {
        success: true,
        delivered,
        total: targetGuilds.length,
        results: sendResults
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
    
    // Store metadata and job handle separately
    scheduledMessages.set(job.id, { ...messageConfig, createdAt: Date.now(), cronPattern });
    scheduledJobs.set(job.id, job);
    // Cap size after insert
    sweepScheduledMessages();
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
    const job = scheduledJobs.get(jobId);
    if (job && typeof job.destroy === 'function') {
        try { job.destroy(); } catch (err) { console.error('Error destroying cron job:', err); }
    }
    scheduledJobs.delete(jobId);
    scheduledMessages.delete(jobId);
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
        } else if (pathname === '/admin/send-auto-setup' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);

            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }

            try {
                const postData = await parsePostData(req);
                const payload = JSON.parse(postData.body || '{}');

                const result = await sendAutoSetupPacket({
                    serverId: payload.serverId,
                    sendAll: Boolean(payload.sendAll)
                });

                const statusCode = result.success ? 200 : 400;
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (error) {
                console.error('Auto setup send error:', error);
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
                try {
                    const now = Date.now();
                    if (!dashboardCache.html || (now - dashboardCache.ts) > ANALYTICS_CACHE_TTL_MS) {
                        const analytics = analyticsService.getAnalytics();
                        const client = global.discordClient;
                        const html = await generateDashboard(analytics, client);
                        dashboardCache = { html, ts: now };
                    }
                    const dashboard = dashboardCache.html;
                    
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(dashboard);
                } catch (error) {
                    console.error('Error generating dashboard:', error);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal Server Error');
                }
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
                    // Cap sessions after insert
                    sweepSessions();
                    
                    res.writeHead(302, {
                        'Set-Cookie': `session=${sessionToken}; HttpOnly; Path=/; Max-Age=${24 * 60 * 60}`,
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
            
        // Monetization API Routes
        } else if (pathname === '/admin/monetization/settings' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                
                await monetizationService.updateGlobalSettings({
                    defaultFreeTranslationLimit: data.defaultFreeTranslationLimit,
                    enableGlobalRestriction: data.enableGlobalRestriction
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error updating monetization settings:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
            
        } else if (pathname === '/admin/monetization/exempt/add' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                
                await monetizationService.addExemptServer(data.serverId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error adding exempt server:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        } else if (pathname === '/admin/monetization/premium/approve' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }

            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body || '{}');
                const { requestId, durationDays } = data;
                if (!requestId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing requestId' }));
                    return;
                }

                // Approve in DB with optional duration
                const approved = await databaseService.approvePremiumRequest(requestId, (sessions.get(sessionToken)?.username || 'admin'), Number(durationDays));
                if (!approved) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Request not found' }));
                    return;
                }

                // Exempt server for duration
                await monetizationService.addExemptServer(approved.serverId, Number(durationDays));

                // Notify requester via DM and post to server (best effort)
                try {
                    const client = global.discordClient;
                    const days = Number(durationDays) || null;
                    const expAt = approved.expiresAt ? new Date(approved.expiresAt) : null;
                    const expStr = expAt ? `${expAt.toLocaleDateString()} ${expAt.toLocaleTimeString()}` : 'until further notice';
                    const dmText = `✅ Your premium request for "${approved.serverName || approved.serverId}" has been approved!\n\n` +
                                   (days ? `Duration: ${days} day(s). Expires: ${expStr}.\n` : `No expiry set (unlimited).\n`) +
                                   `Thanks for supporting Air Translator. Enjoy unlimited translations for the approved period.`;

                    // Build a modern confirmation embed using the same text content
                    const buildApprovalEmbed = (targetName) => {
                        const descriptionLines = [
                            `✅ Your premium request for "${targetName}" has been approved!`,
                            '',
                            days ? `Duration: ${days} day(s). Expires: ${expStr}.` : 'No expiry set (unlimited).',
                            'Thanks for supporting Air Translator. Enjoy unlimited translations for the approved period.'
                        ];
                        return new EmbedBuilder()
                            .setColor('#6C8BFF')
                            .setTitle('💎 Premium Enabled')
                            .setDescription(descriptionLines.join('\n'))
                            .setTimestamp(new Date())
                            .setFooter({ text: 'Air Translator • Confirmation' });
                    };

                    if (client && approved.requesterUserId) {
                        try {
                            const user = await client.users.fetch(approved.requesterUserId);
                            if (user) {
                                const dmEmbed = buildApprovalEmbed(approved.serverName || approved.serverId);
                                await user.send({ embeds: [dmEmbed] }).catch(async () => {
                                    // Fallback to plain text if embed fails
                                    await user.send(dmText);
                                });
                            }
                        } catch (e) {
                            console.warn('Failed to DM requester on approval:', e?.message || e);
                        }

                        try {
                            const guild = await client.guilds.fetch(approved.serverId);
                            if (guild) {
                                // pick a suitable text channel
                                let ch = guild.systemChannel || guild.channels.cache.find(c => c.type === 0 && /general|chat|announce/i.test(c.name));
                                if (!ch) ch = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user)?.has(['SendMessages','EmbedLinks']));
                                if (ch && ch.permissionsFor(client.user)?.has(['SendMessages'])) {
                                    const serverEmbed = buildApprovalEmbed(guild.name || approved.serverId);
                                    if (ch.permissionsFor(client.user)?.has(['EmbedLinks'])) {
                                        await ch.send({ embeds: [serverEmbed] });
                                    } else {
                                        // Fallback to plain text if no EmbedLinks permission
                                        const serverMsg = `💎 Premium enabled for this server${days ? ` for ${days} day(s)` : ''}. ${expAt ? `Expires: ${expStr}.` : ''}`.trim();
                                        await ch.send(serverMsg);
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('Failed to post approval message in server:', e?.message || e);
                        }
                    }
                } catch (_) { /* non-fatal */ }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    serverId: approved.serverId, 
                    serverName: approved.serverName, 
                    durationDays: Number(durationDays) || null,
                    expiresAt: approved.expiresAt || null 
                }));
            } catch (error) {
                console.error('Error approving premium request (admin):', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        } else if (pathname === '/admin/monetization/premium/reject' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }

            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body || '{}');
                const { requestId, reason } = data;
                if (!requestId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing requestId' }));
                    return;
                }

                const rejected = await databaseService.rejectPremiumRequest(requestId, (sessions.get(sessionToken)?.username || 'admin'), reason || null);
                if (!rejected) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Request not found' }));
                    return;
                }

                // Notify requester via DM and post to server (best effort)
                try {
                    const client = global.discordClient;
                    const reasonText = reason && String(reason).trim() ? String(reason).trim() : null;
                    const OFFICIAL_PRICE_URL = 'https://www.patreon.com/c/tsio/membership';
                    const SUPPORT_SERVER_URL = 'https://discord.gg/WeynxzR9nq';
                    const dmLines = [
                        `❌ Your premium request for "${rejected.serverName || rejected.serverId}" has been rejected.`
                    ];
                    if (reasonText) {
                        dmLines.push(`Reason: ${reasonText}`);
                    }
                    dmLines.push(
                        `Visit [official price page](${OFFICIAL_PRICE_URL})`,
                        `Need help? Join our [support server](${SUPPORT_SERVER_URL})`,
                        'If you believe this is a mistake, please contact support.'
                    );
                    const dmText = dmLines.join('\n');

                    const buildRejectionEmbed = (targetName) => {
                        const lines = [
                            `❌ Your premium request for "${targetName}" has been rejected.`,
                        ];
                        if (reasonText) {
                            lines.push('', `Reason: ${reasonText}`);
                        }
                        lines.push(
                            '',
                            `Visit [official price page](${OFFICIAL_PRICE_URL})`,
                            `Need help? Join our [support server](${SUPPORT_SERVER_URL})`,
                            '',
                            'If you believe this is a mistake, please contact support.'
                        );
                        return new EmbedBuilder()
                            .setColor('#ef4444')
                            .setTitle('Premium Request Rejected')
                            .setDescription(lines.join('\n'))
                            .setTimestamp(new Date())
                            .setFooter({ text: 'Air Translator • Notification' });
                    };

                    if (client && rejected.requesterUserId) {
                        try {
                            const user = await client.users.fetch(rejected.requesterUserId);
                            if (user) {
                                const dmEmbed = buildRejectionEmbed(rejected.serverName || rejected.serverId);
                                await user.send({ embeds: [dmEmbed] }).catch(async () => {
                                    await user.send(dmText);
                                });
                            }
                        } catch (e) {
                            console.warn('Failed to DM requester on rejection:', e?.message || e);
                        }

                        try {
                            const guild = await client.guilds.fetch(rejected.serverId);
                            if (guild) {
                                let ch = guild.systemChannel || guild.channels.cache.find(c => c.type === 0 && /general|chat|announce/i.test(c.name));
                                if (!ch) ch = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user)?.has(['SendMessages','EmbedLinks']));
                                if (ch && ch.permissionsFor(client.user)?.has(['SendMessages'])) {
                                    const embed = buildRejectionEmbed(guild.name || rejected.serverId);
                                    if (ch.permissionsFor(client.user)?.has(['EmbedLinks'])) {
                                        await ch.send({ embeds: [embed] });
                                    } else {
                                        await ch.send(dmText);
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('Failed to post rejection message in server:', e?.message || e);
                        }
                    }
                } catch (_) { /* non-fatal */ }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    serverId: rejected.serverId, 
                    serverName: rejected.serverName
                }));
            } catch (error) {
                console.error('Error rejecting premium request (admin):', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
            
        } else if (pathname === '/admin/monetization/exempt/remove' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                
                await monetizationService.removeExemptServer(data.serverId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error removing exempt server:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
            
        } else if (pathname === '/admin/monetization/restrict/add' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                
                await monetizationService.addRestrictedServer(data.serverId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error adding restricted server:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
            
        } else if (pathname === '/admin/monetization/restrict/remove' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                
                await monetizationService.removeRestrictedServer(data.serverId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error removing restricted server:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
            
        } else if (pathname === '/admin/monetization/reset-count' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                
                await monetizationService.resetServerCount(data.serverId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error resetting server count:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Custom limit endpoint
        } else if (pathname === '/admin/monetization/custom-limit' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            
            try {
                const data = await parsePostData(req);
                const { serverId, customLimit } = JSON.parse(data.body);
                
                if (!serverId || !customLimit || customLimit < 1) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid server ID or limit' }));
                    return;
                }
                
                await monetizationService.setCustomLimit(serverId, parseInt(customLimit));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error setting custom limit:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Bulk Actions - Restrict All
        } else if (pathname === '/admin/monetization/bulk/restrict-all' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const client = global.discordClient;
                if (!client) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
                    return;
                }
                
                const servers = Array.from(client.guilds.cache.values());
                let affectedCount = 0;
                
                for (const guild of servers) {
                    try {
                        // Only restrict if not already exempted
                        const status = await monetizationService.checkServerStatus(guild.id);
                        if (!status.isExempt) {
                            await monetizationService.addRestrictedServer(guild.id);
                            affectedCount++;
                        }
                    } catch (err) {
                        console.error(`Failed to restrict server ${guild.id}:`, err);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, affectedCount }));
            } catch (error) {
                console.error('Error in bulk restrict all:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Bulk Actions - Remove All Restrictions
        } else if (pathname === '/admin/monetization/bulk/remove-restrictions' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const client = global.discordClient;
                if (!client) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
                    return;
                }
                
                const servers = Array.from(client.guilds.cache.values());
                let affectedCount = 0;
                
                for (const guild of servers) {
                    try {
                        // Only remove restrictions, don't affect exempted servers
                        const status = await monetizationService.checkServerStatus(guild.id);
                        if (status.isRestricted && !status.isExempt) {
                            await monetizationService.removeRestrictedServer(guild.id);
                            affectedCount++;
                        }
                    } catch (err) {
                        console.error(`Failed to remove restriction for server ${guild.id}:`, err);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, affectedCount }));
            } catch (error) {
                console.error('Error in bulk remove restrictions:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Bulk Actions - Reset All Counts
        } else if (pathname === '/admin/monetization/bulk/reset-counts' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const client = global.discordClient;
                if (!client) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
                    return;
                }
                
                const servers = Array.from(client.guilds.cache.values());
                let affectedCount = 0;
                
                for (const guild of servers) {
                    try {
                        await monetizationService.resetServerCount(guild.id);
                        affectedCount++;
                    } catch (err) {
                        console.error(`Failed to reset count for server ${guild.id}:`, err);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, affectedCount }));
            } catch (error) {
                console.error('Error in bulk reset counts:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Get Server Members Endpoint
        } else if (pathname.startsWith('/admin/servers/') && pathname.endsWith('/members') && req.method === 'GET') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const serverId = pathname.split('/')[3];
                
                if (!serverId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Server ID is required' }));
                    return;
                }
                
                const client = global.discordClient;
                if (!client) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
                    return;
                }
                
                const guild = client.guilds.cache.get(serverId);
                if (!guild) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Server not found' }));
                    return;
                }
                
                // Fetch all members
                await guild.members.fetch();
                
                const members = guild.members.cache.map(member => ({
                    id: member.id,
                    username: member.user.username,
                    displayName: member.displayName,
                    isBot: member.user.bot,
                    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null
                }));
                
                // Sort by display name
                members.sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, members }));
            } catch (error) {
                console.error('Error fetching server members:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Leave Server Endpoint
        } else if (pathname === '/admin/servers/leave' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            
            try {
                const postData = await parsePostData(req);
                const data = JSON.parse(postData.body);
                const { serverId } = data;
                
                if (!serverId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Server ID is required' }));
                    return;
                }
                
                const client = global.discordClient;
                if (!client) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
                    return;
                }
                
                const guild = client.guilds.cache.get(serverId);
                if (!guild) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Server not found' }));
                    return;
                }
                
                const serverName = guild.name;
                
                // Leave the server
                await guild.leave();
                
                console.log(`[Admin] Bot left server: ${serverName} (${serverId})`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: `Successfully left ${serverName}`,
                    serverName 
                }));
            } catch (error) {
                console.error('Error leaving server:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        
        // Delete a specific vote record
        } else if (pathname === '/admin/monetization/vote/delete' && req.method === 'POST') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            try {
                const data = await parsePostData(req);
                const { voteId } = JSON.parse(data.body || '{}');
                if (!voteId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'voteId required' }));
                    return;
                }
                const deleted = await databaseService.deleteVoteEventById(voteId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: deleted }));
            } catch (error) {
                console.error('Error deleting vote record:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Server error' }));
            }

        // Recent votes JSON (bypass dashboard cache)
        } else if (pathname === '/admin/monetization/recent-votes' && req.method === 'GET') {
            const sessionToken = getSessionFromCookies(req.headers.cookie);
            if (!isValidSession(sessionToken)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                return;
            }
            try {
                const client = global.discordClient;
                // Read filters from query params
                const statusFilter = (reqUrl.searchParams.get('status') || 'all').toLowerCase();
                const serverFilter = (reqUrl.searchParams.get('serverId') || '').trim();
                const voteStats = await monetizationService.getVoteStats();
                let recent = voteStats.recentVotes.slice(0, 20);
                if (client && recent.length) {
                    recent = await Promise.all(recent.map(async (vote) => {
                        const uid = vote?.user?.id;
                        if (!uid) return vote;
                        const currentName = vote.user.displayName || vote.user.username || '';
                        const needsEnrich = !currentName || /^\d+$/.test(currentName);
                        if (!needsEnrich) return vote;
                        try {
                            const cached = client.users.cache.get(uid);
                            if (cached) {
                                return {
                                    ...vote,
                                    user: {
                                        ...vote.user,
                                        username: cached.username || vote.user.username,
                                        displayName: cached.displayName || cached.username || vote.user.displayName || vote.user.username
                                    }
                                };
                            }
                            const fetched = await client.users.fetch(uid);
                            return {
                                ...vote,
                                user: {
                                    ...vote.user,
                                    username: fetched?.username || vote.user.username,
                                    displayName: fetched?.displayName || fetched?.username || vote.user.displayName || vote.user.username
                                }
                            };
                        } catch (_) {
                            return vote;
                        }
                    }));
                }

                // Apply filters
                if (statusFilter === 'granted') {
                    recent = recent.filter(v => Number(v.creditsGranted) > 0);
                } else if (statusFilter === 'blocked') {
                    recent = recent.filter(v => !Number(v.creditsGranted) || Number(v.creditsGranted) <= 0);
                }
                if (serverFilter) {
                    recent = recent.filter(v => (v.serverId || '').toString().includes(serverFilter));
                }

                const tbody = recent.map(vote => {
                    const server = client ? client.guilds.cache.get(vote.serverId) : null;
                    const serverName = server ? server.name : 'Unknown Server';
                    const timeAgo = new Date(vote.timestamp).toLocaleString();
                    const rawName = vote.user ? (vote.user.displayName || vote.user.username || '') : '';
                    const isNumericOnly = /^\d+$/.test(rawName);
                    const safeName = vote.user ? (
                        isNumericOnly
                            ? `user_${(vote.user.id || '').toString().slice(-4)}`
                            : rawName || `user_${(vote.user.id || '').toString().slice(-4)}`
                    ) : 'unknown_user';
                    const isGranted = Number(vote.creditsGranted) > 0;
                    const statusCell = isGranted 
                        ? '<span class="status-success">✅ Granted</span>' 
                        : '<span class="status-warning">⏳ Blocked</span>';
                    const userDisplay = vote.user ? 
                        `<span class="user-mention">@${safeName}</span>
                            <br>
                            <small class="text-muted">ID: ${vote.user.id}</small>
                            <br><small class="${vote.creditsGranted > 0 ? 'text-success' : 'text-warning'}">
                                Status: ${vote.creditsGranted > 0 ? 'Credits Granted' : 'Blocked (Cooldown)'}
                            </small>
                            <div class="mt-1">
                                <button class="btn btn-sm btn-outline-secondary me-1" onclick="copyToClipboard('${vote.user.id}')">
                                    Copy ID
                                </button>
                                <button class="btn btn-sm btn-outline-info" onclick="window.open('https://discord.com/users/${vote.user.id}', '_blank')">
                                    Profile
                                </button>
                            </div>` : 
                        '<span class="no-user">Unknown User</span>';
                    return `
                    <tr>
                        <td>
                            <div class="server-info">
                                <strong>${vote.serverId}</strong>
                                <small>${serverName}</small>
                            </div>
                        </td>
                        <td>${userDisplay}</td>
                        <td style="text-align: center;"><span class="credit-badge">+${vote.creditsGranted}</span></td>
                        <td style="text-align: center;">${timeAgo}</td>
                        <td style="text-align: center;">${statusCell}</td>
                        <td style="text-align: center;">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteVoteRecord('${vote.id}')">Delete</button>
                        </td>
                    </tr>`;
                }).join('');

                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(JSON.stringify({ success: true, tbody, count: voteStats.recentVotesCount }));
            } catch (error) {
                console.error('Error fetching recent votes JSON:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Server error' }));
            }

        // Vote webhook endpoint for top.gg
        } else if (pathname === '/webhook/vote' && req.method === 'POST') {
            console.log('🔔 Webhook received at /webhook/vote');
            try {
                const data = await parsePostData(req);
                const body = JSON.parse(data.body);
                
                console.log('📊 Webhook data received:', body);
                
                // Verify webhook if you have authorization setup
                const authHeader = req.headers.authorization;
                console.log('🔑 Auth header:', authHeader ? 'Present' : 'Missing');
                
                if (process.env.TOPGG_WEBHOOK_SECRET && authHeader !== process.env.TOPGG_WEBHOOK_SECRET) {
                    console.log('❌ Unauthorized webhook attempt');
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }
                
                const { user: userId, type, isWeekend } = body;
                
                if (type === 'upvote') {
                    console.log(`📊 Received vote from user ${userId}${isWeekend ? ' (Weekend vote)' : ''}`);
                    
                    // Get the most recent server this user interacted with
                    const recentServerId = global.userServerTracking?.get(userId);
                    
                    if (recentServerId) {
                        // Give reward to the specific server (10 translations instead of 50)
                        const result = await monetizationService.handleVoteReward(userId, recentServerId, 10);
                        
                        if (result.success) {
                            console.log(`✅ Vote reward (10 translations) processed for user ${userId} in server ${recentServerId}`);
                            
                            // Send confirmation message to the user
                            try {
                                const client = global.discordClient;
                                if (client) {
                                    const guild = client.guilds.cache.get(recentServerId);
                                    const user = await client.users.fetch(userId);
                                    
                                    if (guild && user) {
                                        // Try to find a general channel to send the message
                                        const channel = guild.channels.cache.find(ch => 
                                            ch.name.includes('general') || 
                                            ch.name.includes('chat') ||
                                            ch.name.includes('main')
                                        ) || guild.channels.cache.filter(ch => ch.type === 0 && ch.permissionsFor(guild.members.me)?.has('SendMessages')).first();
                                        
                                        if (channel) {
                                            const { EmbedBuilder } = require('discord.js');
                                            const confirmEmbed = new EmbedBuilder()
                                                .setTitle('🎉 Vote Reward Received!')
                                                .setDescription(`Thank you <@${userId}> for voting on Top.gg!\n\n**Your server has received 10 bonus translations!**`)
                                                .setColor('#28a745')
                                                .setFooter({
                                                    text: 'You can vote again in 12 hours for more rewards!',
                                                    iconURL: client.user.displayAvatarURL()
                                                })
                                                .setTimestamp();
                                            
                                            await channel.send({ embeds: [confirmEmbed] });
                                            console.log(`📨 Confirmation message sent to ${guild.name} for ${user.tag}`);
                                        }
                                    }
                                }
                            } catch (msgError) {
                                console.error('Error sending vote confirmation message:', msgError);
                            }
                        }
                    } else {
                        // Fallback: try to handle globally (though less ideal)
                        console.log(`⚠️ No recent server found for user ${userId}, skipping vote reward`);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error processing vote webhook:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
            
        // Test vote webhook endpoint (for debugging)
        } else if (pathname === '/test-vote' && req.method === 'POST') {
            try {
                const data = await parsePostData(req);
                const body = JSON.parse(data.body);
                const { userId, serverId } = body;
                
                console.log(`🧪 Test vote triggered for user ${userId} in server ${serverId}`);
                
                if (userId && serverId) {
                    // Simulate a vote
                    global.userServerTracking = global.userServerTracking || new Map();
                    global.userServerTracking.set(userId, serverId);
                    
                    const result = await monetizationService.handleVoteReward(userId, serverId, 10);
                    
                    if (result.success) {
                        console.log(`✅ Test vote reward (10 translations) processed for user ${userId} in server ${serverId}`);
                        
                        // Send confirmation message
                        try {
                            const client = global.discordClient;
                            if (client) {
                                const guild = client.guilds.cache.get(serverId);
                                const user = await client.users.fetch(userId);
                                
                                if (guild && user) {
                                    const channel = guild.channels.cache.find(ch => 
                                        ch.name.includes('general') || 
                                        ch.name.includes('chat') ||
                                        ch.name.includes('main')
                                    ) || guild.channels.cache.filter(ch => ch.type === 0 && ch.permissionsFor(guild.members.me)?.has('SendMessages')).first();
                                    
                                    if (channel) {
                                        const { EmbedBuilder } = require('discord.js');
                                        const confirmEmbed = new EmbedBuilder()
                                            .setTitle('🧪 Test Vote Reward!')
                                            .setDescription(`Test vote reward for <@${userId}>!\\n\\n**Your server has received 10 bonus translations!**`)
                                            .setColor('#28a745')
                                            .setFooter({
                                                text: 'This was a test vote reward.',
                                                iconURL: client.user.displayAvatarURL()
                                            })
                                            .setTimestamp();
                                        
                                        await channel.send({ embeds: [confirmEmbed] });
                                        console.log(`📨 Test confirmation message sent to ${guild.name} for ${user.tag}`);
                                    }
                                }
                            }
                        } catch (msgError) {
                            console.error('Error sending test vote confirmation message:', msgError);
                        }
                    }
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Test vote processed' }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing userId or serverId' }));
                }
            } catch (error) {
                console.error('Error processing test vote:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
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

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down health server gracefully');
    exemptionExpiryJob.stop();
    server.close(() => {
        console.log('✅ Health server closed');
    });
});

module.exports = server;
