/**
 * Generates the base layout with sidebar and header
 * @param {string} title - Page title
 * @param {string} content - Main content HTML
 * @param {string} activeTab - Active tab identifier
 * @returns {string} Complete HTML page
 */
function generateLayout(title, content, activeTab = 'analytics') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | AirTranslator Admin</title>
    <link rel="stylesheet" href="/admin/public/styles.css">
</head>
<body>
    <div class="app-container">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <span class="logo-icon">🤖</span>
                    <span class="logo-text">AirTranslator</span>
                </div>
                <button class="sidebar-toggle" id="sidebarToggle" aria-label="Toggle sidebar">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3 10H17M3 5H17M3 15H17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>

            <nav class="sidebar-nav">
                <a href="/admin?tab=analytics" class="nav-item ${activeTab === 'analytics' ? 'active' : ''}" data-tab="analytics">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3 17V11M10 17V3M17 17V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span class="nav-text">Analytics</span>
                </a>

                <a href="/admin?tab=messaging" class="nav-item ${activeTab === 'messaging' ? 'active' : ''}" data-tab="messaging">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M17 3H3a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM1 6l7.89 5.26a2 2 0 002.22 0L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="nav-text">Messaging</span>
                </a>

                <a href="/admin?tab=vote-tracking" class="nav-item ${activeTab === 'vote-tracking' ? 'active' : ''}" data-tab="vote-tracking">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M9 2v1m0 14v1m9-8h-1M3 10H2m13.657-5.657l-.707.707M5.05 14.95l-.707.707m9.9 0l.707-.707M5.05 5.05l-.707-.707M13 10a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span class="nav-text">Vote Tracking</span>
                </a>

                <a href="/admin?tab=premium-requests" class="nav-item ${activeTab === 'premium-requests' ? 'active' : ''}" data-tab="premium-requests">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3 6l2-2 4 4 4-4 2 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="nav-text">Premium Requests</span>
                </a>

                <a href="/admin?tab=monetization" class="nav-item ${activeTab === 'monetization' ? 'active' : ''}" data-tab="monetization">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2"/>
                        <path d="M10 6V10L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span class="nav-text">Monetization</span>
                </a>

                <a href="/admin?tab=servers" class="nav-item ${activeTab === 'servers' ? 'active' : ''}" data-tab="servers">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <rect x="2" y="2" width="16" height="5" rx="1" stroke="currentColor" stroke-width="2"/>
                        <rect x="2" y="9" width="16" height="5" rx="1" stroke="currentColor" stroke-width="2"/>
                        <rect x="2" y="16" width="16" height="2" rx="1" fill="currentColor"/>
                    </svg>
                    <span class="nav-text">Servers</span>
                </a>

                <a href="/admin?tab=logs" class="nav-item ${activeTab === 'logs' ? 'active' : ''}" data-tab="logs">
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M9 2H4a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V9M16 2l2 2M10 10l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="nav-text">Activity Log</span>
                </a>
            </nav>

            <div class="sidebar-footer">
                <div class="user-info">
                    <div class="user-avatar">👤</div>
                    <div class="user-details">
                        <div class="user-name">Admin</div>
                        <div class="user-role">Administrator</div>
                    </div>
                </div>
                <a href="/admin/logout" class="logout-btn" title="Logout">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                        <path d="M13 16l4-4m0 0l-4-4m4 4H7m6-7V4a1 1 0 00-1-1H5a1 1 0 00-1 1v12a1 1 0 001 1h7a1 1 0 001-1v-1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </a>
            </div>
        </aside>

        <!-- Main Content -->
        <div class="main-content">
            <!-- Header -->
            <header class="header">
                <div class="header-left">
                    <button class="mobile-menu-toggle" id="mobileMenuToggle" aria-label="Toggle menu">
                        <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                            <path d="M3 10H17M3 5H17M3 15H17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <h1 class="page-title">${title}</h1>
                </div>

                <div class="header-right">
                    <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
                        <svg class="sun-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="4" fill="currentColor"/>
                            <path d="M10 1V3M10 17V19M19 10H17M3 10H1M16.364 3.636L14.95 5.05M5.05 14.95L3.636 16.364M16.364 16.364L14.95 14.95M5.05 5.05L3.636 3.636" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        <svg class="moon-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" fill="currentColor"/>
                        </svg>
                    </button>

                    <div class="header-divider"></div>

                    <button class="notification-btn" aria-label="Notifications">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M15 6.5A5 5 0 005 6.5c0 6-3 7.5-3 7.5h16s-3-1.5-3-7.5zM11.73 17a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span class="notification-badge">3</span>
                    </button>
                </div>
            </header>

            <!-- Page Content -->
            <main class="page-content">
                ${content}
            </main>
        </div>
    </div>

    <!-- Mobile Overlay -->
    <div class="mobile-overlay" id="mobileOverlay"></div>

    <script src="/admin/public/app.js"></script>
</body>
</html>`;
}

module.exports = { generateLayout };
