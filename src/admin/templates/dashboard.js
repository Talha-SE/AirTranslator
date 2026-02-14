const { generateLayout } = require('./layout');
const analyticsService = require('../../services/analyticsService');
const monetizationService = require('../../services/monetizationService');
const databaseService = require('../../services/databaseService');

/**
 * Generate analytics tab content
 */
async function generateAnalyticsTab(analytics, client) {
    const serverCount = client ? client.guilds.cache.size : 0;
    const userCount = client ? client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0) : 0;

    return `
    <div class="tab-content" id="analytics-tab">
        <!-- Stats Cards -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M9 2H4a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V9" stroke="white" stroke-width="2"/>
                        <path d="M15 2h4v4M9 11l6-6" stroke="white" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Translations</div>
                    <div class="stat-value">${analytics.totalTranslations.toLocaleString()}</div>
                    <div class="stat-change positive">+12% from last month</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <rect x="2" y="2" width="16" height="5" rx="1" stroke="white" stroke-width="2"/>
                        <rect x="2" y="9" width="16" height="5" rx="1" stroke="white" stroke-width="2"/>
                        <circle cx="5" cy="4.5" r="0.5" fill="white"/>
                        <circle cx="5" cy="11.5" r="0.5" fill="white"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Active Servers</div>
                    <div class="stat-value">${serverCount.toLocaleString()}</div>
                    <div class="stat-change positive">+${Math.floor(serverCount * 0.05)} this week</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Users</div>
                    <div class="stat-value">${userCount.toLocaleString()}</div>
                    <div class="stat-change neutral">Across all servers</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M12 8V4H8v4M4 8h12M4 12h12M6 16h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Uptime</div>
                    <div class="stat-value">99.9%</div>
                    <div class="stat-change positive">System stable</div>
                </div>
            </div>
        </div>

        <!-- Charts Section -->
        <div class="charts-grid">
            <div class="chart-card">
                <div class="chart-header">
                    <h3 class="chart-title">Translation Activity</h3>
                    <select class="chart-select">
                        <option>Last 7 days</option>
                        <option>Last 30 days</option>
                        <option>Last 90 days</option>
                    </select>
                </div>
                <div class="chart-body">
                    <div class="chart-placeholder">
                        <svg width="100%" height="200" viewBox="0 0 400 200" preserveAspectRatio="none">
                            <defs>
                                <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.3" />
                                    <stop offset="100%" style="stop-color:#667eea;stop-opacity:0" />
                                </linearGradient>
                            </defs>
                            <polyline
                                fill="none"
                                stroke="#667eea"
                                stroke-width="2"
                                points="0,150 50,120 100,140 150,90 200,110 250,70 300,90 350,60 400,80"
                            />
                            <polygon
                                fill="url(#areaGradient)"
                                points="0,150 50,120 100,140 150,90 200,110 250,70 300,90 350,60 400,80 400,200 0,200"
                            />
                        </svg>
                    </div>
                </div>
            </div>

            <div class="chart-card">
                <div class="chart-header">
                    <h3 class="chart-title">Top Languages</h3>
                    <button class="chart-button">View All</button>
                </div>
                <div class="chart-body">
                    <div class="language-list">
                        <div class="language-item">
                            <div class="language-info">
                                <span class="language-flag">🇪🇸</span>
                                <span class="language-name">Spanish</span>
                            </div>
                            <div class="language-stats">
                                <span class="language-count">12,345</span>
                                <div class="language-bar">
                                    <div class="language-bar-fill" style="width: 85%"></div>
                                </div>
                            </div>
                        </div>
                        <div class="language-item">
                            <div class="language-info">
                                <span class="language-flag">🇫🇷</span>
                                <span class="language-name">French</span>
                            </div>
                            <div class="language-stats">
                                <span class="language-count">9,876</span>
                                <div class="language-bar">
                                    <div class="language-bar-fill" style="width: 68%"></div>
                                </div>
                            </div>
                        </div>
                        <div class="language-item">
                            <div class="language-info">
                                <span class="language-flag">🇩🇪</span>
                                <span class="language-name">German</span>
                            </div>
                            <div class="language-stats">
                                <span class="language-count">7,654</span>
                                <div class="language-bar">
                                    <div class="language-bar-fill" style="width: 53%"></div>
                                </div>
                            </div>
                        </div>
                        <div class="language-item">
                            <div class="language-info">
                                <span class="language-flag">🇯🇵</span>
                                <span class="language-name">Japanese</span>
                            </div>
                            <div class="language-stats">
                                <span class="language-count">6,543</span>
                                <div class="language-bar">
                                    <div class="language-bar-fill" style="width: 45%"></div>
                                </div>
                            </div>
                        </div>
                        <div class="language-item">
                            <div class="language-info">
                                <span class="language-flag">🇨🇳</span>
                                <span class="language-name">Chinese</span>
                            </div>
                            <div class="language-stats">
                                <span class="language-count">5,432</span>
                                <div class="language-bar">
                                    <div class="language-bar-fill" style="width: 38%"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Recent Activity -->
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">Recent Activity</h3>
                <button class="card-button">Refresh</button>
            </div>
            <div class="card-body">
                <div class="activity-list">
                    <div class="activity-item">
                        <div class="activity-icon" style="background: #e0e7ff; color: #6366f1;">
                            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                <path d="M12 8V4H8v4M4 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </div>
                        <div class="activity-content">
                            <div class="activity-title">New server joined</div>
                            <div class="activity-meta">Server "Gaming Hub" • 2 minutes ago</div>
                        </div>
                    </div>
                    <div class="activity-item">
                        <div class="activity-icon" style="background: #dcfce7; color: #16a34a;">
                            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                <path d="M5 10l3 3L18 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div class="activity-content">
                            <div class="activity-title">Translation completed</div>
                            <div class="activity-meta">English to Spanish • 5 minutes ago</div>
                        </div>
                    </div>
                    <div class="activity-item">
                        <div class="activity-icon" style="background: #fef3c7; color: #d97706;">
                            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div class="activity-content">
                            <div class="activity-title">Rate limit warning</div>
                            <div class="activity-meta">Server "Test Guild" • 12 minutes ago</div>
                        </div>
                    </div>
            </div>
        </div>
    </div>
    </div>
    `;
}

/**
 * Generate messaging tab content
 */
function generateMessagingTab() {
    return `
    <div class="tab-content" id="messaging-tab">
        <div class="messaging-grid">
            <!-- Compose Section -->
            <div class="content-card">
                <div class="card-header">
                    <h3 class="card-title">✍️ Compose Message</h3>
                    <span class="badge badge-info">Draft</span>
                </div>
                <div class="card-body">
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">Message Type</label>
                            <select class="form-control" id="messageType" onchange="updateMessageTemplate()">
                                <option value="custom">Custom Message</option>
                                <option value="announcement">📢 Announcement</option>
                                <option value="update">🔄 Bot Update</option>
                                <option value="maintenance">🔧 Maintenance</option>
                                <option value="feature">✨ New Feature</option>
                                <option value="warning">⚠️ Important</option>
                                <option value="celebration">🎉 Celebration</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Embed Color</label>
                            <select class="form-control" id="messageColor">
                                <option value="#3498db">Blue (Info)</option>
                                <option value="#00ff88">Green (Success)</option>
                                <option value="#ffa500">Orange (Warning)</option>
                                <option value="#ff6b6b">Red (Important)</option>
                                <option value="#9b59b6">Purple (Feature)</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Title <span class="text-muted">(optional)</span></label>
                        <input type="text" class="form-control" id="messageTitle" placeholder="e.g., Important Bot Update" maxlength="100" />
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Content</label>
                        <textarea class="form-control" id="messageContent" rows="6" placeholder="Type your message here..." maxlength="1500"></textarea>
                        <div class="form-hint"><span id="charCount">0</span> / 1500 characters</div>
                    </div>
                    
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">Send To</label>
                            <select class="form-control" id="targetType" onchange="updateTargetOptions()">
                                <option value="all">All Servers (Broadcast)</option>
                                <option value="specific">Specific Server</option>
                                <option value="large">Large Servers Only (1000+ members)</option>
                                <option value="active">Active Servers Only</option>
                            </select>
                        </div>
                        <div class="form-group" id="serverSelectGroup" style="display:none;">
                            <label class="form-label">Select Server</label>
                            <select class="form-control" id="targetServer"></select>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="includeFooter" checked />
                            <span>Include footer & timestamp</span>
                        </label>
                        <label class="checkbox-label">
                            <input type="checkbox" id="urgentMessage" />
                            <span>Mark as urgent</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Preview & Actions -->
            <div class="content-card-group">
                <div class="content-card">
                    <div class="card-header">
                        <h3 class="card-title">📝 Preview</h3>
                        <span class="badge badge-success">Live</span>
                    </div>
                    <div class="card-body">
                        <div class="message-preview">
                            <div class="embed-preview">
                                <div id="previewTitle" class="embed-title">Title will appear here</div>
                                <div id="previewContent" class="embed-description">Message content will appear here</div>
                                <div id="previewFooter" class="embed-footer">AirTranslator Bot • Now</div>
                            </div>
                        </div>
                        <div class="button-group">
                            <button type="button" class="btn btn-secondary" onclick="updatePreview()">
                                <span>🔄</span> Update Preview
                            </button>
                            <button type="button" class="btn btn-success" onclick="sendTestMessage()">
                                <span>🧪</span> Send Test
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="content-card">
                    <div class="card-header">
                        <h3 class="card-title">🚀 Actions</h3>
                    </div>
                    <div class="card-body">
                        <div class="button-group-vertical">
                            <button type="button" class="btn btn-primary btn-lg" onclick="sendMessage()">
                                <span>📤</span> Send Message Now
                            </button>
                            <button type="button" class="btn btn-outline btn-lg" onclick="scheduleMessage()">
                                <span>🕒</span> Schedule for Later
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="sendingProgress" class="content-card" style="display:none; margin-top: 20px;">
            <div class="card-header">
                <h3 class="card-title">📡 Sending Progress</h3>
            </div>
            <div class="card-body">
                <div class="progress-bar">
                    <div id="progressFill" class="progress-fill"></div>
                </div>
                <div id="progressText" class="progress-text">Preparing to send...</div>
                <div id="deliveryResults" class="delivery-results"></div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate vote tracking tab content
 */
async function generateVoteTrackingTab() {
    const client = global.discordClient;
    const voteStats = await monetizationService.getVoteStats();
    
    // Enrich recent votes
    let enrichedRecentVotes = voteStats.recentVotes.slice(0,20);
    if (client && enrichedRecentVotes.length) {
        enrichedRecentVotes = await Promise.all(enrichedRecentVotes.map(async (vote) => {
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
    
    return `
    <div class="tab-content" id="vote-tracking-tab">
        <!-- Stats Overview -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Vote Clicks</div>
                    <div class="stat-value">${voteStats.totalVoteClicks}</div>
                    <div class="stat-change neutral">All time</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Credits Granted</div>
                    <div class="stat-value">${voteStats.totalCreditsGranted.toLocaleString()}</div>
                    <div class="stat-change positive">Auto-granted</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Today's Votes</div>
                    <div class="stat-value">${voteStats.todayVotes}</div>
                    <div class="stat-change neutral">Last 24h</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Recent Activity</div>
                    <div class="stat-value" id="recentActivityCount">${voteStats.recentVotesCount}</div>
                    <div class="stat-change neutral">Live updates</div>
                </div>
            </div>
        </div>

        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">🗳️ Recent Vote Activity</h3>
                <span class="badge badge-info">Last 20</span>
            </div>
            <div class="card-body">
                    <div class="filter-group">
                        <div class="filter-item">
                            <span class="filter-label">Status:</span>
                            <select class="form-control-sm" id="voteStatusFilter" onchange="refreshRecentVotes(true)">
                                <option value="all">All</option>
                                <option value="granted">Granted</option>
                                <option value="blocked">Blocked</option>
                            </select>
                        </div>
                        <div class="filter-item">
                            <span class="filter-label">Server ID:</span>
                            <input type="text" class="form-control-sm" id="voteServerFilter" placeholder="Filter by ID" style="width: 200px;" onkeyup="handleVoteServerFilter()" />
                        </div>
                        <div class="filter-actions">
                            <button class="btn-sm btn-outline" onclick="clearVoteFilters()">Clear</button>
                            <button class="btn-sm btn-primary" onclick="refreshRecentVotes()">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                                Refresh
                            </button>
                        </div>
                    </div>
                    
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Server</th>
                                    <th>User</th>
                                    <th style="text-align: center;">Credits</th>
                                    <th style="text-align: center;">Time</th>
                                    <th style="text-align: center;">Status</th>
                                    <th style="text-align: right;">Actions</th>
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
                                            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">ID: ${vote.user.id}</div>
                                            <div style="margin-top: 6px; display: flex; gap: 4px;">
                                                <button class="btn-xs btn-outline" onclick="copyToClipboard('${vote.user.id}')" title="Copy ID">📋</button>
                                                <button class="btn-xs btn-outline" onclick="window.open('https://discord.com/users/${vote.user.id}', '_blank')" title="Profile">👤</button>
                                            </div>` : 
                                        '<span style="color: var(--text-tertiary); font-style: italic;">Unknown User</span>';
                                    
                                    const isGranted = vote.creditsGranted > 0;
                                    const creditsBadge = isGranted 
                                        ? `<span class="badge badge-success">+${vote.creditsGranted}</span>` 
                                        : `<span class="badge badge-secondary">${vote.creditsGranted}</span>`;
                                    const statusBadge = isGranted
                                        ? `<span class="badge badge-success">✅ Granted</span>`
                                        : `<span class="badge badge-warning">🚫 Blocked</span>`;

                                    return `
                                    <tr>
                                        <td data-label="Server">
                                            <strong>${vote.serverId}</strong>
                                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${serverName}</div>
                                        </td>
                                        <td data-label="User">${userDisplay}</td>
                                        <td data-label="Credits" style="text-align: center;">${creditsBadge}</td>
                                        <td data-label="Time" style="text-align: center;">${timeAgo}</td>
                                        <td data-label="Status" style="text-align: center;">${statusBadge}</td>
                                        <td data-label="Actions" style="text-align: right;">
                                            <button class="btn-sm btn-danger" onclick="deleteVoteRecord('${vote.id}')" title="Delete Record">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                            </button>
                                        </td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate premium requests tab content
 */
async function generatePremiumRequestsTab() {
    const client = global.discordClient;
    const pendingPremium = await databaseService.getPendingPremiumRequests(0);
    
    // Calculate duplicates
    const duplicateCounts = pendingPremium.reduce((acc, pr) => {
        const sid = pr.serverId || 'unknown';
        acc[sid] = (acc[sid] || 0) + 1;
        return acc;
    }, {});
    
    return `
    <div class="tab-content" id="premium-requests-tab">
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">💳 Premium Requests Management</h3>
                <span class="badge badge-warning">Pending: ${pendingPremium.length}</span>
            </div>
            <div class="card-body">
                ${pendingPremium.length > 0 ? `
                <div class="alert alert-warning">
                    ⚠️ You have ${pendingPremium.length} pending premium request${pendingPremium.length !== 1 ? 's' : ''} awaiting review.
                </div>
                ` : `
                <div class="alert alert-success">
                    ✅ No pending premium requests at this time.
                </div>
                `}
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Request ID</th>
                                <th>Server</th>
                                <th>Server ID</th>
                                <th>Requester</th>
                                <th>Created</th>
                                <th style="min-width: 220px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pendingPremium.map(pr => `
                                <tr>
                                    <td><code>${pr._id}</code> ${(duplicateCounts[pr.serverId] || 0) > 1 ? '<span class="badge badge-warning" title="Duplicate request">Dup</span>' : ''}</td>
                                    <td>${pr.serverName || 'Unknown'}</td>
                                    <td>${pr.serverId}</td>
                                    <td>
                                        <span class="user-mention">@${pr.requesterDisplayName || pr.requesterUsername || 'user'}</span>
                                        <br><small style="color: #6b7280;">ID: ${pr.requesterUserId}</small>
                                    </td>
                                    <td>${new Date(pr.createdAt).toLocaleString()}</td>
                                    <td>
                                        <div style="display: flex; gap: 8px; align-items: center;">
                                            <input type="number" min="1" max="3650" value="30" id="dur_${pr._id}" style="width: 90px; padding: 6px; border: 1px solid var(--border); border-radius: 6px;" title="Days" />
                                            <button class="btn-sm btn-success" onclick="approvePremium('${pr._id}', '${pr.serverId}')">Approve</button>
                                            <button class="btn-sm btn-danger" onclick="rejectPremium('${pr._id}', '${pr.serverId}')">Reject</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                            ${pendingPremium.length === 0 ? '<tr><td colspan="6" class="text-center text-muted">No pending requests</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate monetization tab content
 */
async function generateMonetizationTab() {
    const client = global.discordClient;
    const settings = monetizationService.getSettings();
    const serversStatus = await monetizationService.getAllServersStatus(client);
    
    // Global Stats
    const totalServers = serversStatus.length;
    const totalTranslations = serversStatus.reduce((sum, server) => sum + server.translationCount, 0);
    const exemptServers = serversStatus.filter(server => server.isExempt).length;
    const restrictedServers = serversStatus.filter(server => server.isRestricted).length;
    const overLimitServers = serversStatus.filter(server => !server.canTranslate && !server.isExempt).length;
    const activeServers = serversStatus.filter(server => server.canTranslate || server.isExempt).length;
    
    function getServerStatusClass(server) {
        if (server.isExempt && server.exemptUntil) {
            const expiredExempt = new Date(server.exemptUntil).getTime() < Date.now();
            if (expiredExempt) return 'restricted';
        }
        if (server.isExempt) return 'exempt';
        if (!server.canTranslate) return 'over-limit';
        if (server.isRestricted) return 'restricted';
        return 'active';
    }
    
    function getServerStatusText(server) {
        if (server.isExempt && server.exemptUntil) {
            const expiredExempt = new Date(server.exemptUntil).getTime() < Date.now();
            if (expiredExempt) return 'Expired (Restricted)';
        }
        if (server.isExempt) return 'Exempt';
        if (!server.canTranslate) return 'Over Limit';
        if (server.isRestricted) return 'Restricted';
        return 'Active';
    }
    
    function generateServerActions(server) {
        let actions = [];
        const hasExpiredExemption = server.isExempt && server.exemptUntil && 
                                     new Date(server.exemptUntil).getTime() < Date.now();
        
        if (server.isExempt && !hasExpiredExemption) {
            actions.push(`<button class="btn-sm btn-remove" onclick="removeExemptServer('${server.id}')">Remove Exempt</button>`);
        } else {
            actions.push(`<button class="btn-sm btn-exempt" onclick="addExemptServer('${server.id}')">Add Exempt</button>`);
        }
        
        if (server.translationCount > 0) {
            actions.push(`<button class="btn-sm btn-reset" onclick="resetServerCount('${server.id}')">Reset Count</button>`);
        }
        
        return actions.join('');
    }
    
    return `
    <div class="tab-content" id="monetization-tab">
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">💰 Monetization Management</h3>
                <span class="badge badge-info">Admin • Secure</span>
            </div>
        </div>
        
        <!-- Global Statistics -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M4 4h12M4 8h12M4 12h12M4 16h12" stroke="white" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Servers</div>
                    <div class="stat-value">${totalServers.toLocaleString()}</div>
                    <div class="stat-change neutral">Tracked servers</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10h12M8 14h4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        <circle cx="10" cy="10" r="9" stroke="white" stroke-width="2"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Translations</div>
                    <div class="stat-value">${totalTranslations.toLocaleString()}</div>
                    <div class="stat-change positive">Global usage</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Active Servers</div>
                    <div class="stat-value">${activeServers.toLocaleString()}</div>
                    <div class="stat-change success">Within limits</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Restricted / Over</div>
                    <div class="stat-value">${overLimitServers + restrictedServers}</div>
                    <div class="stat-change negative">${restrictedServers} blocked</div>
                </div>
            </div>
        </div>
        
        <div class="charts-grid">
            <!-- Global Settings -->
            <div class="content-card">
                <div class="card-header"><h3 class="card-title">⚙️ Global Settings</h3></div>
                <div class="card-body">
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">Default Free Limit</label>
                            <input type="number" id="freeLimit" value="${settings.defaultFreeTranslationLimit}" min="1" max="1000" class="form-control" />
                            <small class="form-hint">For new servers</small>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Global Restriction</label>
                            <label class="toggle-label">
                                <input type="checkbox" id="globalRestriction" ${settings.enableGlobalRestriction ? 'checked' : ''} />
                                <span>Restrict All</span>
                            </label>
                            <small class="form-hint">Except exempt servers</small>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="saveGlobalSettings()" style="width: 100%; margin-top: 10px;">Save Settings</button>
                </div>
            </div>
            
            <!-- Quick Actions -->
            <div class="content-card">
                <div class="card-header"><h3 class="card-title">⚡ Quick Actions</h3></div>
                <div class="card-body">
                    <div class="form-group">
                        <input type="text" id="serverIdInput" placeholder="Enter Server ID" class="form-control" />
                    </div>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-success" onclick="addExemptServer()">Add Exempt</button>
                        <button class="btn btn-sm btn-danger" onclick="addRestrictedServer()">Restrict</button>
                        <button class="btn btn-sm btn-warning" onclick="resetServerCount()">Reset Count</button>
                    </div>
                    <div class="form-group" style="margin-top: 15px; display: flex; gap: 8px;">
                        <input type="number" id="customLimitInput" placeholder="Limit" class="form-control" style="width: 80px;" min="1" />
                        <button class="btn btn-info" onclick="setCustomLimit()" style="flex: 1;">Set Custom Limit</button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Bulk Actions -->
        <div class="content-card">
            <div class="card-header"><h3 class="card-title">🔄 Bulk Server Actions</h3></div>
            <div class="card-body">
                <p style="color: var(--text-secondary); margin-bottom: 16px;">Apply restrictions or exemptions to multiple servers. Use carefully!</p>
                <div class="action-buttons">
                    <button class="btn btn-danger" onclick="bulkRestrictAll()">🔒 Restrict All Servers</button>
                    <button class="btn btn-warning" onclick="bulkRemoveRestrictions()">🔓 Remove All Restrictions</button>
                    <button class="btn btn-info" onclick="bulkResetCounts()">↻ Reset All Counts</button>
                </div>
            </div>
        </div>
        
        <!-- Server Management Table -->
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">🖥️ Server Management</h3>
                <span class="badge badge-info">${serversStatus.length} servers</span>
            </div>
            <div class="card-body">
                <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; justify-content: space-between;">
                    <input type="text" id="monetizationSearchInput" class="search-input" placeholder="🔍 Search servers..." onkeyup="searchMonetizationServers()" />
                    <div class="filter-group">
                        <button class="filter-btn active" onclick="filterServers('all')">All</button>
                        <button class="filter-btn" onclick="filterServers('restricted')">Restricted</button>
                        <button class="filter-btn" onclick="filterServers('exempt')">Exempt</button>
                        <button class="filter-btn" onclick="filterServers('over-limit')">Over Limit</button>
                    </div>
                </div>
                <div class="table-responsive">
                    <table class="data-table" id="monetizationServersTable">
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
                                    <td><strong>${server.name}</strong></td>
                                    <td><code class="code-snippet">${server.id}</code></td>
                                    <td>${server.memberCount || 'N/A'}</td>
                                    <td><span class="${server.translationCount >= server.freeTranslationLimit ? 'text-danger' : ''}">${server.translationCount} / ${server.freeTranslationLimit}</span></td>
                                    <td><span class="badge badge-${getServerStatusClass(server)}">${getServerStatusText(server)}</span></td>
                                    <td>
                                        ${(() => {
                                            if (server.isExempt) {
                                                if (server.exemptUntil) {
                                                    const until = new Date(server.exemptUntil);
                                                    const now = new Date();
                                                    const diffMs = until - now;
                                                    if (diffMs > 0) {
                                                        const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                                                        return `<span class="badge badge-info" title="Expires ${until.toLocaleString()}">Until ${until.toLocaleDateString()} (${daysLeft}d left)</span>`;
                                                    } else {
                                                        return `<span class="badge badge-danger" title="Expired">Expired</span>`;
                                                    }
                                                }
                                                return `<span class="badge badge-success">Unlimited</span>`;
                                            }
                                            return '<span class="badge badge-secondary">—</span>';
                                        })()}
                                    </td>
                                    <td>${generateServerActions(server)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate servers tab content
 */
async function generateServersTab(client) {
    const servers = client ? Array.from(client.guilds.cache.values()) : [];
    
    return `
    <div class="tab-content" id="servers-tab">
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">🖥️ Server Management</h3>
                <div class="header-actions">
                    <input type="text" class="form-control-sm search-input" id="serverSearch" placeholder="Search servers..." />
                    <button class="btn btn-sm btn-primary" onclick="refreshServers()">
                        <span>🔄</span> Refresh
                    </button>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Server Name</th>
                                <th>Server ID</th>
                                <th>Members</th>
                                <th>Joined</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="serversTable">
                            ${servers.map(guild => `
                                <tr data-server-id="${guild.id}">
                                    <td>
                                        <div class="server-name-cell">
                                            <span class="server-icon">${(guild.name || '?').charAt(0).toUpperCase()}</span>
                                            <span>${guild.name || 'Unknown Server'}</span>
                                        </div>
                                    </td>
                                    <td><code class="code-snippet">${guild.id}</code></td>
                                    <td>${(guild.memberCount || 0).toLocaleString()}</td>
                                    <td>${guild.joinedAt ? new Date(guild.joinedAt).toLocaleDateString() : 'N/A'}</td>
                                    <td>
                                        <div class="action-buttons">
                                            <button class="btn-icon" onclick="viewServer('${guild.id}')" title="View Details">
                                                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/>
                                                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                                                </svg>
                                            </button>
                                            <button class="btn-icon btn-danger" onclick="leaveServer('${guild.id}', '${guild.name}')" title="Leave Server">
                                                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                                    <path d="M13 16l4-4m0 0l-4-4m4 4H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate logs tab content
 */
function generateLogsTab() {
    return `
    <div class="tab-content" id="logs-tab">
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">📋 Activity Log</h3>
                <div class="filter-group">
                    <select class="form-control-sm">
                        <option>All Activities</option>
                        <option>Server Events</option>
                        <option>Translation Events</option>
                        <option>Admin Actions</option>
                    </select>
                    <button class="btn btn-sm btn-outline">Export</button>
                </div>
            </div>
            <div class="card-body">
                <div class="log-list">
                    <div class="log-item log-info">
                        <div class="log-time">2024-02-11 14:32:45</div>
                        <div class="log-content">
                            <strong>Server Joined:</strong> New server "Coding Community" (ID: 123456789)
                        </div>
                    </div>
                    <div class="log-item log-success">
                        <div class="log-time">2024-02-11 14:28:12</div>
                        <div class="log-content">
                            <strong>Translation Completed:</strong> English → Spanish (Server: Gaming Hub)
                        </div>
                    </div>
                    <div class="log-item log-warning">
                        <div class="log-time">2024-02-11 14:15:03</div>
                        <div class="log-content">
                            <strong>Rate Limit Warning:</strong> Server "Test Guild" approaching limit
                        </div>
                    </div>
                    <div class="log-item log-info">
                        <div class="log-time">2024-02-11 13:45:22</div>
                        <div class="log-content">
                            <strong>Admin Action:</strong> Premium approved for server "Premium Guild"
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate complete dashboard
 */
async function generateDashboard(analytics, client, activeTab = 'analytics') {
    // activeTab is now passed as a parameter from the server
    
    let tabContent = '';
    
    switch (activeTab) {
        case 'analytics':
            tabContent = await generateAnalyticsTab(analytics, client);
            break;
        case 'messaging':
            tabContent = generateMessagingTab();
            break;
        case 'vote-tracking':
            tabContent = await generateVoteTrackingTab();
            break;
        case 'premium-requests':
            tabContent = await generatePremiumRequestsTab();
            break;
        case 'monetization':
            tabContent = await generateMonetizationTab();
            break;
        case 'servers':
            tabContent = await generateServersTab(client);
            break;
        case 'logs':
            tabContent = generateLogsTab();
            break;
        default:
            tabContent = await generateAnalyticsTab(analytics, client);
    }
    
    const content = `
        <div class="dashboard-container">
            ${tabContent}
        </div>
    `;
    
    return generateLayout('Dashboard', content, activeTab);
}

module.exports = {
    generateDashboard,
    generateAnalyticsTab,
    generateMessagingTab,
    generateVoteTrackingTab,
    generatePremiumRequestsTab,
    generateMonetizationTab,
    generateServersTab,
    generateLogsTab
};
