/**
 * Generates the HTML for the modern admin login page
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
  <link rel="stylesheet" href="/admin/public/styles.css" />
  <style>
    body {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      background-attachment: fixed;
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

    .login-card {
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
    .login-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 25px 70px rgba(0,0,0,.23), 0 0 0 1px rgba(255,255,255,.5) inset;
    }

    .brand {
      text-align: center;
      margin-bottom: 24px;
    }
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
      color: var(--text-primary);
      margin-bottom: 6px;
    }
    .subtitle {
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.4;
    }

    .error-alert {
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
    .error-alert::before {
      content: '⚠️';
      font-size: 18px;
    }

    .form-field {
      margin-bottom: 16px;
    }
    .form-label {
      display: block;
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .input-wrapper {
      position: relative;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 2px solid var(--border-color);
      border-radius: 10px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: all 0.2s ease;
    }
    .form-input:hover {
      border-color: var(--border-hover);
    }
    .form-input:focus {
      box-shadow: 0 0 0 3px rgba(102, 126, 234, .18);
      border-color: var(--primary);
      background: var(--bg-primary);
    }
    .icon-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: 0;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 8px;
      border-radius: 8px;
      transition: color 0.2s ease;
    }
    .icon-btn:hover {
      color: var(--text-primary);
    }

    .form-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: -6px 0 18px;
    }
    .remember-label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-primary);
      font-size: 13px;
      cursor: pointer;
      user-select: none;
    }
    .remember-label input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

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
      border-top: 1px solid var(--border-color);
      color: var(--text-secondary);
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 480px) {
      body {
        padding: 12px;
      }
      .login-card {
        padding: 24px 20px;
        border-radius: 16px;
      }
      .brand {
        margin-bottom: 18px;
      }
      .title {
        font-size: 22px;
      }
      .logo {
        width: 48px;
        height: 48px;
        font-size: 24px;
        margin-bottom: 10px;
      }
    }
  </style>
</head>
<body>
  <main class="login-card">
    <div class="brand">
      <div class="logo">🤖</div>
      <h1 class="title">Welcome Back</h1>
      <p class="subtitle">Sign in to access the AirTranslator admin dashboard</p>
    </div>

    ${error ? `<div class="error-alert">${error}</div>` : ''}

    <form method="POST" action="/admin/login" id="loginForm" novalidate>
      <div class="form-field">
        <label class="form-label" for="username">Username</label>
        <input class="form-input" type="text" id="username" name="username" autocomplete="username" placeholder="Enter your username" required />
      </div>

      <div class="form-field">
        <label class="form-label" for="password">Password</label>
        <div class="input-wrapper">
          <input class="form-input" type="password" id="password" name="password" autocomplete="current-password" placeholder="Enter your password" required style="padding-right: 48px;" />
          <button class="icon-btn" type="button" id="togglePwd" aria-label="Show password">👁️</button>
        </div>
      </div>

      <div class="form-row">
        <label class="remember-label">
          <input type="checkbox" id="rememberMe" name="remember" value="true" />
          <span>Remember me</span>
        </label>
      </div>

      <div>
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

module.exports = { generateLoginPage };
