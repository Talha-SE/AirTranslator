const http = require('http');
const crypto = require('crypto');
const analyticsService = require('./analyticsService');
const monetizationService = require('./monetizationService');
const databaseService = require('./databaseService');
const nodeCron = require('node-cron');
const { EmbedBuilder } = require('discord.js');

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
      --bg: #0f1220;
      --bg-soft: #151933;
      --card: #0b1022;
      --text: #e9ecf1;
      --muted: #a7b0c0;
      --primary: #6c8bff;
      --primary-600: #5677ff;
      --danger: #ff6b6b;
      --success: #00d28f;
      --input: #202648;
      --ring: 0 0 0 3px rgba(108, 139, 255, .35);
    }
    @media (prefers-color-scheme: light) {
      :root { --bg:#eef2ff; --bg-soft:#e7ecff; --card:#ffffff; --text:#111526; --muted:#5b6375; --input:#eef1ff; }
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji";
      background: radial-gradient(1200px 600px at 10% -10%, rgba(108,139,255,.25), transparent 55%),
                  radial-gradient(800px 600px at 110% 10%, rgba(118,75,162,.22), transparent 55%),
                  var(--bg);
      color: var(--text); display: grid; place-items: center; padding: 24px;
    }

    .card {
      width: 100%; max-width: 430px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,0)) , var(--card);
      border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 28px; position: relative;
      box-shadow: 0 20px 60px rgba(0,0,0,.45);
    }

    .brand { display:flex; align-items:center; gap:12px; margin-bottom: 8px; }
    .logo { display:grid; place-items:center; width:40px; height:40px; border-radius: 10px; background: linear-gradient(135deg, #667eea, #764ba2); box-shadow: 0 6px 18px rgba(118,75,162,.35); font-size: 20px; }
    .title { font-weight: 700; font-size: 20px; letter-spacing: .2px; }
    .subtitle { color: var(--muted); margin: 0 0 18px 52px; font-size: 13px; }
    .chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 8px; border-radius:999px; background:#eef2ff; color:#4f46e5; border:1px solid #e0e7ff; }

    .error { background: rgba(255,107,107,.12); color: #ffd7d7; border: 1px solid rgba(255,107,107,.35); padding: 10px 12px; border-radius: 10px; margin: 12px 0 18px; font-size: 13px; }

    .field { margin-bottom: 14px; }
    .label { display:flex; justify-content: space-between; align-items:center; color: var(--muted); font-size: 12px; margin: 0 0 6px; }
    .input-wrap { position: relative; }
    .input {
      width: 100%; padding: 12px 42px 12px 40px; background: var(--input); color: var(--text);
      border: 1px solid rgba(255,255,255,.08); border-radius: 12px; font-size: 15px; outline: none; transition: box-shadow .15s ease, border-color .15s ease;
    }
    .input:focus { box-shadow: var(--ring); border-color: var(--primary); }
    .leading { position:absolute; left: 12px; top: 50%; transform: translateY(-50%); opacity: .65; font-size: 16px; }
    .trailing { position:absolute; right: 10px; top: 50%; transform: translateY(-50%); opacity: .8; }
    .icon-btn { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 6px; border-radius: 8px; }
    .icon-btn:focus-visible { outline: none; box-shadow: var(--ring); }

    .row { display:flex; justify-content: space-between; align-items:center; gap: 12px; margin: 6px 0 4px; }
    .helper { color: var(--muted); font-size: 12px; }
    .caps { color: var(--danger); display: none; }

    .actions { margin-top: 14px; display:flex; flex-direction: column; gap: 10px; }
    .btn-primary {
      appearance: none; border: 0; background: linear-gradient(135deg, var(--primary), #8ea2ff);
      color: white; padding: 12px 14px; border-radius: 12px; font-weight: 600; letter-spacing:.2px; cursor:pointer; transition: transform .05s ease, filter .15s ease;
    }
    .btn-primary:hover { filter: brightness(1.04); }
    .btn-primary:active { transform: translateY(1px); }
    .btn-ghost { background: transparent; border: 1px solid rgba(255,255,255,.12); color: var(--text); padding: 10px 12px; border-radius: 10px; cursor: pointer; }

    .footer { margin-top: 14px; color: var(--muted); font-size: 12px; text-align: center; }
    .topbar { position:absolute; inset: 10px 10px auto auto; display:flex; gap:8px; }

    .switch { display:flex; align-items:center; gap:8px; }
    .switch input { display:none; }
    .switch .knob { width: 42px; height: 24px; background: var(--bg-soft); border:1px solid rgba(255,255,255,.12); border-radius: 999px; position: relative; transition: background .2s ease; }
    .switch .knob::after { content:''; position:absolute; width: 18px; height: 18px; background:#fff; border-radius: 999px; top: 2.5px; left: 3px; transition: transform .2s ease; }
    .switch input:checked + .knob { background: #1b2144; }
    .switch input:checked + .knob::after { transform: translateX(18px); }

    @media (max-width: 480px) { .card { padding: 22px; } .subtitle { margin-left: 0; } }
  </style>
</head>
<body>
  <main class="card" id="card">
    <div class="topbar">
      <label class="switch" title="Toggle theme">
        <input type="checkbox" id="themeToggle" />
        <div class="knob"></div>
      </label>
    </div>

    <div class="brand">
      <div class="logo">🤖</div>
      <div class="title">AirTranslator Admin</div>
      <span class="chip">Admin • Secure</span>
    </div>
    <p class="subtitle">Secure access for authorized administrators.</p>

    ${error ? `<div class="error">${error}</div>` : ''}

    <form method="POST" action="/admin/login" id="loginForm" novalidate>
      <div class="field">
        <label class="label" for="username">
          <span>Username</span>
          <span class="helper" id="savedHint" style="display:none;">prefilled</span>
        </label>
        <div class="input-wrap">
          <span class="leading">👤</span>
          <input class="input" type="text" id="username" name="username" autocomplete="username" placeholder="e.g. admin" required />
        </div>
      </div>

      <div class="field">
        <label class="label" for="password">
          <span>Password</span>
          <span class="helper caps" id="capsHint">Caps Lock is ON</span>
        </label>
        <div class="input-wrap">
          <span class="leading">🔒</span>
          <input class="input" type="password" id="password" name="password" autocomplete="current-password" placeholder="Your secure password" required />
          <button class="trailing icon-btn" type="button" id="togglePwd" aria-label="Show password">👁️</button>
        </div>
      </div>

      <div class="row">
        <label class="helper"><input type="checkbox" id="rememberMe" /> Remember username</label>
        <span class="helper" id="statusText"></span>
      </div>

      <div class="actions">
        <button type="submit" class="btn-primary" id="submitBtn">Sign in</button>
        <button type="button" class="btn-ghost" id="clearBtn" style="display:none;">Clear saved username</button>
      </div>
    </form>

    <p class="footer">AirTranslator Admin Panel • Authorized Access Only</p>
  </main>

  <script>
    (function() {
      const form = document.getElementById('loginForm');
      const username = document.getElementById('username');
      const password = document.getElementById('password');
      const submitBtn = document.getElementById('submitBtn');
      const capsHint = document.getElementById('capsHint');
      const togglePwd = document.getElementById('togglePwd');
      const remember = document.getElementById('rememberMe');
      const savedHint = document.getElementById('savedHint');
      const clearBtn = document.getElementById('clearBtn');
      const statusText = document.getElementById('statusText');
      const themeToggle = document.getElementById('themeToggle');

      // Theme persistence
      const savedTheme = localStorage.getItem('at_theme');
      if (savedTheme === 'light') document.documentElement.style.setProperty('color-scheme','light');
      if (savedTheme === 'dark') document.documentElement.style.setProperty('color-scheme','dark');
      themeToggle.checked = savedTheme === 'dark';
      themeToggle.addEventListener('change', () => {
        const mode = themeToggle.checked ? 'dark' : 'light';
        document.documentElement.style.setProperty('color-scheme', mode);
        localStorage.setItem('at_theme', mode);
      });

      // Prefill username if remembered
      const savedUser = localStorage.getItem('at_admin_user');
      if (savedUser) {
        username.value = savedUser;
        remember.checked = true;
        savedHint.style.display = 'inline';
        clearBtn.style.display = 'inline-block';
      }

      clearBtn.addEventListener('click', () => {
        localStorage.removeItem('at_admin_user');
        username.value = '';
        remember.checked = false;
        savedHint.style.display = 'none';
        clearBtn.style.display = 'none';
      });

      // Caps Lock detection
      function handleCaps(e){
        const caps = e.getModifierState && e.getModifierState('CapsLock');
        capsHint.style.display = caps ? 'inline' : 'none';
      }
      password.addEventListener('keydown', handleCaps);
      password.addEventListener('keyup', handleCaps);

      // Password visibility
      togglePwd.addEventListener('click', () => {
        const isPwd = password.type === 'password';
        password.type = isPwd ? 'text' : 'password';
        togglePwd.textContent = isPwd ? '🙈' : '👁️';
      });

      // Enter-to-submit
      function handleEnter(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (username.value.trim() && password.value) {
            if (form.requestSubmit) form.requestSubmit(); else form.submit();
          } else {
            statusText.textContent = 'Please enter username and password.';
            statusText.style.color = 'var(--danger)';
          }
        }
      }
      username.addEventListener('keydown', handleEnter);
      password.addEventListener('keydown', handleEnter);

      // Basic validation + submit state
      form.addEventListener('submit', (e) => {
        if (!username.value.trim() || !password.value) {
          e.preventDefault();
          statusText.textContent = 'Please enter username and password.';
          statusText.style.color = 'var(--danger)';
          return;
        }
        if (remember.checked) {
          localStorage.setItem('at_admin_user', username.value.trim());
        } else {
          localStorage.removeItem('at_admin_user');
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';
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
                                    <th>Credits Granted</th>
                                    <th>Timestamp</th>
                                    <th>Status</th>
                                    <th>Actions</th>
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
                                        `<td>
                                            <span class="user-mention">@${safeName}</span>
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
                                            </div>
                                        </td>` : 
                                        '<td><span class="no-user">Unknown User</span></td>';
                                    return `
                                    <tr>
                                        <td>
                                            <div class="server-info">
                                                <strong>${vote.serverId}</strong>
                                                <small>${serverName}</small>
                                            </div>
                                        </td>
                                        <td>${userDisplay}</td>
                                        <td><span class="credit-badge">+${vote.creditsGranted}</span></td>
                                        <td>${timeAgo}</td>
                                        <td><span class="status-success">✅ Granted</span></td>
                                        <td>
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
                                                            return `<span class="status-badge">Expired</span>`;
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
    if (server.isExempt) return 'exempt';
    if (!server.canTranslate) return 'over-limit';
    if (server.isRestricted) return 'restricted';
    return 'active';
}

function getServerStatusText(server) {
    if (server.isExempt) return 'Exempt';
    if (!server.canTranslate) return 'Over Limit';
    if (server.isRestricted) return 'Restricted';
    return 'Active';
}

function generateServerActions(server) {
    let actions = [];
    
    if (server.isExempt) {
        actions.push(`<button class="btn-remove" onclick="removeExemptServer('${server.id}')">Remove Exempt</button>`);
    } else if (server.isRestricted) {
        actions.push(`<button class="btn-exempt" onclick="addExemptServer('${server.id}')">Add Exempt</button>`);
        actions.push(`<button class="btn-remove" onclick="removeRestrictedServer('${server.id}')">Remove Restriction</button>`);
    } else {
        actions.push(`<button class="btn-exempt" onclick="addExemptServer('${server.id}')">Add Exempt</button>`);
        actions.push(`<button class="btn-restrict" onclick="addRestrictedServer('${server.id}')">Add Restriction</button>`);
    }
    
    if (server.translationCount > 0) {
        actions.push(`<button class="btn-reset" onclick="resetServerCount('${server.id}')">Reset Count</button>`);
    }
    
    return actions.join('');
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
    
    function filterServers(type) {
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
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
        <div style="position: relative;">
            <h1>AirTranslator Admin Dashboard</h1>
            <p>Complete Analytics & Server Management</p>
            <a href="/admin/logout" class="logout-btn">Logout</a>
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
                    const dmText = `❌ Your premium request for "${rejected.serverName || rejected.serverId}" has been rejected.` + (reasonText ? `\nReason: ${reasonText}` : '');

                    const buildRejectionEmbed = (targetName) => {
                        const lines = [
                            `❌ Your premium request for "${targetName}" has been rejected.`,
                        ];
                        if (reasonText) {
                            lines.push('', `Reason: ${reasonText}`);
                        }
                        lines.push('', 'If you believe this is a mistake, please contact support.');
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
                        `<td>
                            <span class="user-mention">@${safeName}</span>
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
                            </div>
                        </td>` : 
                        '<td><span class="no-user">Unknown User</span></td>';
                    return `
                    <tr>
                        <td>
                            <div class="server-info">
                                <strong>${vote.serverId}</strong>
                                <small>${serverName}</small>
                            </div>
                        </td>
                        <td>${userDisplay}</td>
                        <td><span class="credit-badge">+${vote.creditsGranted}</span></td>
                        <td>${timeAgo}</td>
                        <td>${statusCell}</td>
                        <td>
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

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down health server gracefully');
    server.close(() => {
        console.log('✅ Health server closed');
    });
});

module.exports = server;
