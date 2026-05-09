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
    const normalizeLanguageCode = (lang) => (lang || '').toString().trim().toLowerCase();
    const languagePopularity = {};
    let totalLanguageUsages = 0;

    Object.entries(analytics.languageUsage || {}).forEach(([pair, count]) => {
        const safeCount = Number(count) || 0;
        if (safeCount <= 0) return;
        const parts = String(pair || '').split(/\s*(?:->|\u2192)\s*/);
        const target = normalizeLanguageCode(parts.length > 1 ? parts[1] : pair);
        if (!target) return;
        languagePopularity[target] = (languagePopularity[target] || 0) + safeCount;
        totalLanguageUsages += safeCount;
    });

    const totalLanguageRowsLabel = totalLanguageUsages.toLocaleString();

    return `
    <div class="tab-content" id="analytics-tab">
        <!-- Dashboard Welcome Section -->
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Analytics Overview</h2>
                <p>Track your bot's performance and growth across the Discord ecosystem.</p>
            </div>
            <div class="welcome-actions">
                <button class="btn btn-outline btn-sm" onclick="window.location.reload()">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M17 10a7 7 0 11-1.5-4.3M17 5v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Refresh Data
                </button>
                <button class="btn btn-primary btn-sm">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M3 15v4m6-8v8m6-12v12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
                    Export Report
                </button>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon" style="background: var(--primary-light); color: var(--primary);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Translations</div>
                    <div class="stat-value">${analytics.totalTranslations.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend positive">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                            12.5%
                        </span>
                        <span class="trend-label">vs last month</span>
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Active Servers</div>
                    <div class="stat-value">${serverCount.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend positive">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                            5.2%
                        </span>
                        <span class="trend-label">this week</span>
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--info);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Users</div>
                    <div class="stat-value">${userCount.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend neutral">Global Reach</span>
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">System Uptime</div>
                    <div class="stat-value">99.98%</div>
                    <div class="stat-footer">
                        <span class="trend-status online"></span>
                        <span class="trend-label">All systems operational</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="analytics-grid">
            <!-- Main Chart Card -->
            <div class="content-card main-chart-card">
                <div class="card-header">
                    <div class="card-title-group">
                        <h3 class="card-title">Translation Volume</h3>
                        <p class="card-subtitle">Daily translation requests across all servers</p>
                    </div>
                    <div class="card-actions">
                        <div class="segmented-control">
                            <button class="active">7D</button>
                            <button>30D</button>
                            <button>90D</button>
                        </div>
                    </div>
                </div>
                <div class="card-body">
                    <div class="chart-container">
                        <div class="chart-placeholder-modern">
                            <svg width="100%" height="240" viewBox="0 0 800 240" preserveAspectRatio="none">
                                <defs>
                                    <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.2" />
                                        <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
                                    </linearGradient>
                                </defs>
                                <path d="M0,200 Q100,180 200,120 T400,140 T600,80 T800,100 V240 H0 Z" fill="url(#chartGradient)" />
                                <path d="M0,200 Q100,180 200,120 T400,140 T600,80 T800,100" fill="none" stroke="var(--primary)" stroke-width="3" />
                                <circle cx="200" cy="120" r="4" fill="white" stroke="var(--primary)" stroke-width="2" />
                                <circle cx="400" cy="140" r="4" fill="white" stroke="var(--primary)" stroke-width="2" />
                                <circle cx="600" cy="80" r="4" fill="white" stroke="var(--primary)" stroke-width="2" />
                            </svg>
                        </div>
                        <div class="chart-labels">
                            <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Side Cards -->
            <div class="side-cards">
                <div class="content-card language-card">
                    <div class="card-header">
                        <h3 class="card-title">Top Languages</h3>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button class="card-button" type="button" onclick="showAllLanguagesModal()">
                                More details
                            </button>
                            <span class="badge badge-info" id="languages-live-total">${totalLanguageRowsLabel} tracked</span>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="language-ranking" id="top-languages-list">
                            <div class="lang-item">
                                <div class="lang-meta">
                                    <span class="lang-flag">ES</span>
                                    <span class="lang-name">Spanish</span>
                                    <span class="lang-percent">34%</span>
                                </div>
                                <div class="lang-progress">
                                    <div class="lang-bar" style="width: 34%"></div>
                                </div>
                            </div>
                            <div class="lang-item">
                                <div class="lang-meta">
                                    <span class="lang-flag">FR</span>
                                    <span class="lang-name">French</span>
                                    <span class="lang-percent">21%</span>
                                </div>
                                <div class="lang-progress">
                                    <div class="lang-bar" style="width: 21%"></div>
                                </div>
                            </div>
                            <div class="lang-item">
                                <div class="lang-meta">
                                    <span class="lang-flag">DE</span>
                                    <span class="lang-name">German</span>
                                    <span class="lang-percent">18%</span>
                                </div>
                                <div class="lang-progress">
                                    <div class="lang-bar" style="width: 18%"></div>
                                </div>
                            </div>
                            <div class="lang-item">
                                <div class="lang-meta">
                                    <span class="lang-flag">JA</span>
                                    <span class="lang-name">Japanese</span>
                                    <span class="lang-percent">15%</span>
                                </div>
                                <div class="lang-progress">
                                    <div class="lang-bar" style="width: 15%"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="content-card activity-card">
                    <div class="card-header">
                        <h3 class="card-title">Recent Events</h3>
                    </div>
                    <div class="card-body">
                        <div class="modern-activity-list">
                            <div class="m-activity-item">
                                <div class="m-activity-dot online"></div>
                                <div class="m-activity-info">
                                    <div class="m-activity-title">New Premium Server</div>
                                    <div class="m-activity-time">2m ago</div>
                                </div>
                            </div>
                            <div class="m-activity-item">
                                <div class="m-activity-dot"></div>
                                <div class="m-activity-info">
                                    <div class="m-activity-title">Large Broadcast Sent</div>
                                    <div class="m-activity-time">15m ago</div>
                                </div>
                            </div>
                            <div class="m-activity-item">
                                <div class="m-activity-dot warning"></div>
                                <div class="m-activity-info">
                                    <div class="m-activity-title">API Rate Limit Hit</div>
                                    <div class="m-activity-time">1h ago</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="languages-modal-overlay" id="languagesModalOverlay" onclick="hideAllLanguagesModal()"></div>
        <div class="languages-modal" id="languagesDetailsModal" role="dialog" aria-modal="true" aria-labelledby="languagesDetailsHeading">
            <div class="card-header">
                <h3 class="card-title" id="languagesDetailsHeading">All Tracked Languages</h3>
                <button class="btn btn-outline btn-sm" type="button" onclick="hideAllLanguagesModal()">Close</button>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Language</th>
                                <th>Code</th>
                                <th>Count</th>
                                <th>Share</th>
                            </tr>
                        </thead>
                        <tbody id="allLanguagesTableBody">
                            <tr>
                                <td colspan="4" style="text-align: center; padding: 32px; color: var(--text-tertiary);">
                                    Loading language data...
                                </td>
                            </tr>
                        </tbody>
                    </table>
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
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Broadcast Center</h2>
                <p>Compose and send global announcements to all servers using the bot.</p>
            </div>
            <div class="welcome-actions">
                <button class="btn btn-outline btn-sm" onclick="clearMessageForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    Clear Draft
                </button>
            </div>
        </div>

        <div class="messaging-grid">
            <!-- Compose Section -->
            <div class="content-card">
                <div class="card-header">
                    <div class="card-title-group">
                        <h3 class="card-title">Compose Message</h3>
                        <p class="card-subtitle">Design your announcement embed</p>
                    </div>
                    <span class="badge badge-info">Draft Mode</span>
                </div>
                <div class="card-body">
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">Message Type</label>
                            <select class="form-control" id="messageType" onchange="updateMessageTemplate()">
                                <option value="custom">Custom Message</option>
                                <option value="announcement">Announcement</option>
                                <option value="update">Bot Update</option>
                                <option value="maintenance">Maintenance</option>
                                <option value="feature">New Feature</option>
                                <option value="warning">Important</option>
                                <option value="celebration">Celebration</option>
                                <option value="premium">Premium Campaign</option>
                                <option value="unlimitedUsage">Unlimited Usage Offer</option>
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
                                <option value="selected">Selected Servers</option>
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
                            <input type="checkbox" id="excludeExemptServers" onchange="handleExcludeExemptServersChange()" />
                            <span>Exclude exempt servers (show only non-exempt servers)</span>
                        </label>
                    </div>

                    <div class="form-group" id="selectedServersGroup" style="display:none;">
                        <label class="form-label">Select Multiple Servers</label>
                        <div class="selected-servers-panel">
                            <div class="selected-servers-toolbar">
                                <input
                                    type="text"
                                    class="form-control"
                                    id="selectedServerSearch"
                                    placeholder="Search servers by name..."
                                    oninput="renderSelectedServersList()"
                                />
                                <div class="selected-servers-actions">
                                    <button type="button" class="btn btn-outline btn-sm" onclick="selectAllFilteredServers()">Select Visible</button>
                                    <button type="button" class="btn btn-outline btn-sm" onclick="clearSelectedServers()">Clear</button>
                                </div>
                            </div>
                            <div class="selected-servers-filters">
                                <input type="number" class="form-control" id="selectedMinMembers" placeholder="Min members" min="0" oninput="renderSelectedServersList()" />
                                <input type="number" class="form-control" id="selectedMaxMembers" placeholder="Max members" min="0" oninput="renderSelectedServersList()" />
                                <input type="date" class="form-control" id="selectedJoinedAfter" onchange="renderSelectedServersList()" />
                                <input type="date" class="form-control" id="selectedJoinedBefore" onchange="renderSelectedServersList()" />
                            </div>
                            <div class="selected-servers-meta" id="selectedServersMeta">0 selected</div>
                            <div class="selected-servers-list" id="selectedServersList"></div>
                        </div>
                    </div>
                    
                    <div class="form-group" style="display: flex; gap: 24px; flex-wrap: wrap;">
                        <label class="checkbox-label">
                            <input type="checkbox" id="includeFooter" checked />
                            <span>Include footer & timestamp</span>
                        </label>
                        <label class="checkbox-label">
                            <input type="checkbox" id="urgentMessage" />
                            <span>Mark as urgent</span>
                        </label>
                        <label class="checkbox-label">
                            <input type="checkbox" id="sendAsText" />
                            <span>Send as plain text (no card)</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Preview & Actions -->
            <div class="side-cards">
                <div class="content-card">
                    <div class="card-header">
                        <div class="card-title-group">
                            <h3 class="card-title">Live Preview</h3>
                            <p class="card-subtitle">How it will look in Discord</p>
                        </div>
                        <span class="badge badge-success">Live</span>
                    </div>
                    <div class="card-body">
                        <div class="message-preview">
                            <div class="embed-preview">
                                <div id="previewTitle" class="embed-title">Title will appear here</div>
                                <div id="previewContent" class="embed-description">Message content will appear here</div>
                                <div id="previewFooter" class="embed-footer">AirTranslator Bot - Now</div>
                            </div>
                        </div>
                        <div class="button-group">
                            <button type="button" class="btn btn-outline btn-sm" style="flex: 1;" onclick="updatePreview()">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path></svg>
                                Refresh
                            </button>
                            <button type="button" class="btn btn-outline btn-sm" style="flex: 1;" onclick="sendTestMessage()">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                Send Test
                            </button>
                        </div>
                    </div>
                </div>

                <div class="content-card" style="border: 1px solid rgba(139, 92, 246, 0.2); box-shadow: 0 18px 40px rgba(99, 102, 241, 0.08);">
                    <div class="card-header" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(245, 158, 11, 0.08));">
                        <div class="card-title-group">
                            <h3 class="card-title">Premium Message</h3>
                            <p class="card-subtitle">Ready-made copy for premium onboarding and upgrades</p>
                        </div>
                        <span class="badge badge-warning">Campaign Ready</span>
                    </div>
                    <div class="card-body">
                        <div style="padding: 16px; border-radius: 14px; border: 1px solid var(--border-color); background: linear-gradient(180deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.04));">
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                                <span class="badge badge-info">Patreon ready</span>
                                <span class="badge badge-success">Embed friendly</span>
                                <span class="badge badge-warning">One-click preset</span>
                            </div>
                            <div style="white-space: pre-line; max-height: 240px; overflow-y: auto; font-size: 13px; line-height: 1.7; color: var(--text-secondary);">Unlock Full Access - Only $5/month

Follow these simple steps:
1. Click the card button below or open the Patreon link: https://www.patreon.com/c/tsio/membership
2. Subscribe to the membership plan you like.
3. Come back to this Discord server and click the approval button to request access.
4. Type /premium to see your premium details.

Your subscription is securely handled by Patreon.com, and we do not process your payment details directly.

You will get a notification when your premium plan is enabled.</div>
                        </div>
                        <div class="button-group" style="margin-top: 16px;">
                            <button type="button" class="btn btn-outline btn-sm" style="flex: 1;" onclick="loadPremiumMessageTemplate()">
                                Load Copy
                            </button>
                            <button type="button" class="btn btn-primary btn-sm" style="flex: 1;" onclick="sendPremiumMessage()">
                                Send Premium
                            </button>
                        </div>
                    </div>
                </div>                <div class="content-card auto-campaign-card">
                    <div class="card-header">
                        <div class="card-title-group">
                            <h3 class="card-title">Auto Campaign</h3>
                            <p class="card-subtitle">Send unlimited usage offer to newly joined servers after first <span id="autoCampaignTriggerCount">5</span> translated messages.</p>
                        </div>
                    </div>
                    <div class="card-body">
                        <label class="toggle-label" style="justify-content: space-between; width: 100%;">
                            <span style="font-weight: 600; color: var(--text-primary);">Enable Auto Offer</span>
                            <input type="checkbox" id="autoUnlimitedCampaignEnabled" onchange="toggleAutoUnlimitedCampaign(this.checked)" />
                        </label>
                        <div class="form-hint" id="autoCampaignStatus" style="justify-content: flex-start; margin-top: 12px;">
                            Loading campaign status...
                        </div>
                    </div>
                </div>
                
                <div class="content-card">
                    <div class="card-header">
                        <div class="card-title-group">
                            <h3 class="card-title">Deployment</h3>
                            <p class="card-subtitle">Global broadcast actions</p>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="button-group-vertical">
                            <button type="button" class="btn btn-primary" style="padding: 14px;" onclick="sendMessage()">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                Send Global Broadcast
                            </button>
                            <button type="button" class="btn btn-outline" style="padding: 14px;" onclick="scheduleMessage()">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                Schedule for Later
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="sendingProgress" class="content-card" style="display:none; margin-top: 24px;">
            <div class="card-header">
                <div class="card-title-group">
                    <h3 class="card-title">Sending Progress</h3>
                    <p class="card-subtitle">Global delivery in progress</p>
                </div>
            </div>
            <div class="card-body">
                <div class="progress-bar">
                    <div id="progressFill" class="progress-fill"></div>
                </div>
                <div id="progressText" class="progress-text">Preparing to send...</div>
                <div id="currentServerStatus" style="margin-bottom: 15px; font-weight: 600; color: var(--primary); text-align: center; height: 24px;"></div>
                
                <div class="delivery-results" id="deliveryResults" style="display: flex; gap: 15px; justify-content: center; margin-bottom: 20px;">
                    <div class="result-item" style="text-align: center;">
                        <span class="result-value" id="successCount" style="font-size: 1.5rem; font-weight: bold; color: var(--success); display: block;">0</span>
                        <span class="result-label" style="font-size: 0.85rem; color: var(--text-secondary);">Success</span>
                    </div>
                    <div class="result-item" style="text-align: center;">
                        <span class="result-value" id="failCount" style="font-size: 1.5rem; font-weight: bold; color: var(--danger); display: block;">0</span>
                        <span class="result-label" style="font-size: 0.85rem; color: var(--text-secondary);">Failed</span>
                    </div>
                </div>

                <div class="detailed-log-container" style="margin-top: 20px; max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.9rem;">
                    <table style="width: 100%; text-align: left; border-collapse: collapse;">
                        <thead style="background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1;">
                            <tr>
                                <th style="padding: 10px 15px; font-weight: 600; color: var(--text-secondary);">Server</th>
                                <th style="padding: 10px 15px; font-weight: 600; color: var(--text-secondary);">Status</th>
                                <th style="padding: 10px 15px; font-weight: 600; color: var(--text-secondary);">Details</th>
                            </tr>
                        </thead>
                        <tbody id="detailedLogBody">
                        </tbody>
                    </table>
                </div>
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
    let enrichedRecentVotes = voteStats.recentVotes;
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
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Vote Tracking</h2>
                <p>Monitor real-time voting activity and credit distributions across all servers.</p>
            </div>
            <div class="header-actions">
                <button class="btn btn-primary btn-sm" onclick="refreshRecentVotes()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    Refresh Data
                </button>
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom: 32px;">
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Vote Clicks</div>
                    <div class="stat-value">${voteStats.totalVoteClicks.toLocaleString()}</div>
                    <div class="stat-change neutral">Lifetime</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
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
                <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Today's Votes</div>
                    <div class="stat-value">${voteStats.todayVotes.toLocaleString()}</div>
                    <div class="stat-change neutral">Last 24h</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Recent Activity</div>
                    <div class="stat-value" id="recentActivityCount">${voteStats.recentVotesCount.toLocaleString()}</div>
                    <div class="stat-change neutral">Active window</div>
                </div>
            </div>
        </div>

        <div class="charts-grid" style="margin-bottom: 32px;">
            <!-- Vote Reward Settings -->
            <div class="content-card">
                <div class="card-header"><h3 class="card-title">Vote Reward Settings</h3></div>
                <div class="card-body">
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">Bonus Translations Per Vote</label>
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <input type="number" id="voteBonusAmount" value="${monetizationService.getSettings().voteBonusAmount || 20}" min="1" max="1000" class="form-control" style="max-width: 120px;" />
                                <button class="btn btn-primary" onclick="saveVoteBonusAmount()">Save</button>
                            </div>
                            <small class="form-hint">Free translations granted per successful vote (1-1000)</small>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Vote Stats Overview -->
            <div class="content-card">
                <div class="card-header">
                    <div class="card-title-group">
                        <h3 class="card-title">Vote Stats</h3>
                        <p class="card-subtitle">Real-time distribution metrics</p>
                    </div>
                </div>
                <div class="card-body">
                    <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 0;">
                        <div class="stat-card" style="padding: 16px;">
                            <div class="stat-label">Avg Credits/Vote</div>
                            <div class="stat-value" style="font-size: 20px;">${voteStats.totalVoteClicks > 0 ? (voteStats.totalCreditsGranted / voteStats.totalVoteClicks).toFixed(1) : 0}</div>
                        </div>
                        <div class="stat-card" style="padding: 16px;">
                            <div class="stat-label">Conversion Rate</div>
                            <div class="stat-value" style="font-size: 20px;">${voteStats.totalVoteClicks > 0 ? ((voteStats.totalCreditsGranted > 0 ? voteStats.recentVotes.filter(v => v.creditsGranted > 0).length / Math.max(voteStats.recentVotes.length, 1) * 100 : 0)).toFixed(1) : 0}%</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="content-card">
            <div class="card-header">
                <div class="card-title-group">
                    <h3 class="card-title"> Vote Activity Feed</h3>
                    <p class="card-subtitle">Detailed log of all votes in the last 24 hours</p>
                </div>
                <div class="card-actions">
                    <span class="badge badge-info" style="padding: 6px 12px;">Last 24 Hours</span>
                </div>
            </div>
            <div class="card-body">
                <div class="filter-group" style="margin-bottom: 24px; padding: 20px; background: var(--bg-secondary); border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end;">
                    <div class="filter-item" style="flex: 1; min-width: 200px;">
                        <span class="filter-label" style="display: block; margin-bottom: 8px; font-size: 11px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Filter by Status</span>
                        <select class="form-control" id="voteStatusFilter" onchange="refreshRecentVotes(true)" style="width: 100%; height: 40px; border-radius: 8px; background: var(--card-bg);">
                            <option value="all">All Statuses</option>
                            <option value="granted">Granted Only</option>
                            <option value="blocked">Blocked Only</option>
                        </select>
                    </div>
                    <div class="filter-item" style="flex: 1; min-width: 200px;">
                        <span class="filter-label" style="display: block; margin-bottom: 8px; font-size: 11px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Search Server ID</span>
                        <div style="position: relative;">
                            <svg style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary);" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                            <input type="text" class="form-control" id="voteServerFilter" placeholder="Enter ID..." onkeyup="handleVoteServerFilter()" style="width: 100%; height: 40px; border-radius: 8px; background: var(--card-bg); padding-left: 36px;" />
                        </div>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-outline" onclick="clearVoteFilters()" style="height: 40px; border-radius: 8px; padding: 0 20px;">
                            Reset Filters
                        </button>
                    </div>
                </div>
                
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Server Info</th>
                                <th>Voter Profile</th>
                                <th style="text-align: center;">Reward</th>
                                <th style="text-align: center;">Timestamp</th>
                                <th style="text-align: center;">Status</th>
                                <th style="text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="recentVotesTbody">
                            ${enrichedRecentVotes.map(vote => {
                                const server = client ? client.guilds.cache.get(vote.serverId) : null;
                                const serverName = server ? server.name : 'Unknown Server';
                                const timestamp = new Date(vote.timestamp);
                                const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                const dateStr = timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                
                                const rawName = vote.user ? (vote.user.displayName || vote.user.username || '') : '';
                                const isNumericOnly = /^\d+$/.test(rawName);
                                const safeName = vote.user ? (
                                    isNumericOnly
                                        ? `user_${(vote.user.id || '').toString().slice(-4)}`
                                        : rawName || `user_${(vote.user.id || '').toString().slice(-4)}`
                                ) : 'unknown_user';
                                
                                const userDisplay = vote.user ? 
                                    `<div class="user-info-cell">
                                        <div class="user-name" style="font-weight: 600; color: var(--text-primary);">@${safeName}</div>
                                        <div class="user-id" style="font-size: 11px; color: var(--text-tertiary);">ID: ${vote.user.id}</div>
                                    </div>` : 
                                    '<span class="text-muted">Unknown User</span>';
                                
                                const isGranted = vote.creditsGranted > 0;
                                const creditsBadge = isGranted 
                                    ? `<span class="badge badge-success" style="font-weight: 700;">+${vote.creditsGranted} Credits</span>` 
                                    : `<span class="badge badge-secondary" style="opacity: 0.6;">${vote.creditsGranted} Credits</span>`;
                                const statusBadge = isGranted
                                    ? `<div style="display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--success); font-weight: 600; font-size: 13px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> Granted</div>`
                                    : `<div style="display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--warning); font-weight: 600; font-size: 13px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Blocked</div>`;

                                return `
                                <tr>
                                    <td>
                                        <div class="server-info-cell">
                                            <div class="server-name" style="font-weight: 600; color: var(--text-primary);">${serverName}</div>
                                            <div class="server-id" style="font-size: 11px; color: var(--text-tertiary); font-family: monospace;">${vote.serverId}</div>
                                        </div>
                                    </td>
                                    <td>${userDisplay}</td>
                                    <td style="text-align: center;">${creditsBadge}</td>
                                    <td style="text-align: center;">
                                        <div class="time-cell">
                                            <div class="time-main" style="font-weight: 600; font-size: 13px;">${timeStr}</div>
                                            <div class="time-sub" style="font-size: 11px; color: var(--text-tertiary);">${dateStr}</div>
                                        </div>
                                    </td>
                                    <td style="text-align: center;">${statusBadge}</td>
                                    <td style="text-align: right;">
                                        <div class="action-buttons">
                                            <button class="btn-icon btn-outline" onclick="window.open('https://discord.com/users/${vote.user?.id}', '_blank')" title="View Discord Profile">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                            </button>
                                            <button class="btn-icon btn-danger" onclick="deleteVoteRecord('${vote.id}')" title="Delete Log Entry">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>`;
                            }).join('')}
                            ${enrichedRecentVotes.length === 0 ? '<tr><td colspan="6" style="text-align: center; padding: 48px; color: var(--text-tertiary);">No voting activity recorded in the last 24 hours.</td></tr>' : ''}
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
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Premium Subscriptions</h2>
                <p>Review and manage manual premium activation requests from server owners.</p>
            </div>
            <div class="premium-badge-group">
                <span class="badge badge-warning" style="padding: 10px 16px; font-size: 14px;">
                    ${pendingPremium.length} Pending Requests
                </span>
            </div>
        </div>

        <div class="content-card">
            <div class="card-header">
                <div class="card-title-group">
                    <h3 class="card-title"> Request Queue</h3>
                    <p class="card-subtitle">Review each request carefully before approval</p>
                </div>
                <div class="card-actions">
                    <button class="btn btn-outline btn-sm" onclick="window.location.reload()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path></svg>
                        Refresh Queue
                    </button>
                </div>
            </div>
            <div class="card-body">
                ${pendingPremium.length > 0 ? `
                <div class="alert alert-warning">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    Action Required: ${pendingPremium.length} request${pendingPremium.length !== 1 ? 's' : ''} awaiting your review.
                </div>
                ` : `
                <div class="alert alert-success">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Queue Empty: All premium requests have been processed.
                </div>
                `}

                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Server Details</th>
                                <th>Requester</th>
                                <th>Submission Date</th>
                                <th style="text-align: center;">Status</th>
                                <th style="text-align: right; min-width: 280px;">Approval Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pendingPremium.map(pr => {
                                const isDuplicate = (duplicateCounts[pr.serverId] || 0) > 1;
                                return `
                                <tr>
                                    <td>
                                        <div class="server-info-cell">
                                            <div style="display: flex; align-items: center; gap: 8px;">
                                                <strong style="font-size: 15px;">${pr.serverName || 'Unknown Server'}</strong>
                                                ${isDuplicate ? '<span class="duplicate-indicator" title="Multiple requests from this server">!</span>' : ''}
                                            </div>
                                            <div class="server-id-badge">ID: ${pr.serverId}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <div class="user-info-cell">
                                            <span class="user-mention" style="font-weight: 600;">@${pr.requesterDisplayName || pr.requesterUsername || 'user'}</span>
                                            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">ID: ${pr.requesterUserId}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style="font-size: 13px; color: var(--text-secondary);">
                                            ${new Date(pr.createdAt).toLocaleDateString()}
                                            <div style="font-size: 11px; color: var(--text-tertiary);">${new Date(pr.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                        </div>
                                    </td>
                                    <td style="text-align: center;">
                                        <span class="badge badge-warning">Pending</span>
                                    </td>
                                    <td style="text-align: right;">
                                        <div style="display: flex; gap: 12px; align-items: center; justify-content: flex-end;">
                                            <div class="action-input-group">
                                                <span class="duration-label">DAYS</span>
                                                <input type="number" min="1" max="3650" value="30" id="dur_${pr._id}" class="duration-input" />
                                            </div>
                                            <div class="action-btn-group">
                                                <button class="btn btn-success btn-sm" onclick="approvePremium('${pr._id}', '${pr.serverId}')" style="background: #10b981; border: none;">
                                                    Approve
                                                </button>
                                                <button class="btn btn-outline btn-sm" onclick="rejectPremium('${pr._id}', '${pr.serverId}')" style="color: #ef4444; border-color: #fca5a5;">
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `}).join('')}
                            ${pendingPremium.length === 0 ? '<tr><td colspan="5" style="text-align: center; padding: 48px; color: var(--text-tertiary);">No pending requests in the queue.</td></tr>' : ''}
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

    function formatCalendarDate(dateValue) {
        if (!dateValue) return '-';
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return '-';
        return parsed.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function formatDateInputValue(dateValue) {
        if (!dateValue) return '';
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return '';
        return parsed.toISOString().slice(0, 10);
    }
    
    return `
    <div class="tab-content" id="monetization-tab">
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">Monetization Management</h3>
                <span class="badge badge-info">Admin - Secure</span>
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
                <div class="card-header"><h3 class="card-title">Global Settings</h3></div>
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
                <div class="card-header"><h3 class="card-title">Quick Actions</h3></div>
                <div class="card-body">
                    <div class="form-group">
                        <input type="text" id="serverIdInput" placeholder="Enter Server ID" class="form-control" />
                    </div>
                    <div class="action-buttons">
                        <button class="btn btn-primary btn-sm" onclick="addExemptServer()">Add Exempt</button>
                        <button class="btn btn-danger btn-sm" onclick="addRestrictedServer()">Restrict</button>
                        <button class="btn btn-warning btn-sm" onclick="resetServerCount()">Reset Count</button>
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
            <div class="card-header"><h3 class="card-title">Bulk Server Actions</h3></div>
            <div class="card-body">
                <p style="color: var(--text-secondary); margin-bottom: 16px;">Apply restrictions or exemptions to multiple servers. Use carefully!</p>
                <div class="action-buttons">
                    <button class="btn btn-danger" onclick="bulkRestrictAll()">Restrict All Servers</button>
                    <button class="btn btn-warning" onclick="bulkRemoveRestrictions()">Remove All Restrictions</button>
                    <button class="btn btn-info" onclick="bulkResetCounts()">Reset All Counts</button>
                </div>
            </div>
        </div>
        
        <!-- Server Management Table -->
        <div class="content-card">
            <div class="card-header">
                <h3 class="card-title">Server Management</h3>
                <span class="badge badge-info">${serversStatus.length} servers</span>
            </div>
            <div class="card-body">
                <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; justify-content: space-between;">
                    <input type="text" id="monetizationSearchInput" class="search-input" placeholder="Search servers..." onkeyup="searchMonetizationServers()" />
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
                                <th>Premium Joined</th>
                                <th>Next Renewal</th>
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
                                            return '<span class="badge badge-secondary">-</span>';
                                        })()}
                                    </td>
                                    <td>
                                        ${server.premiumJoinedAt
                                            ? `<span class="badge badge-info">${formatCalendarDate(server.premiumJoinedAt)}</span>`
                                            : '<span class="badge badge-secondary">Not set</span>'
                                        }
                                    </td>
                                    <td>
                                        ${server.nextRenewalDate
                                            ? `<span class="badge badge-success" title="Renews monthly on the same day">${formatCalendarDate(server.nextRenewalDate)}</span>`
                                            : '<span class="badge badge-secondary">-</span>'
                                        }
                                    </td>
                                    <td>
                                        <div style="display: flex; flex-direction: column; gap: 8px;">
                                            <div>${generateServerActions(server)}</div>
                                            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                                <input
                                                    type="date"
                                                    id="premiumJoinDate_${server.id}"
                                                    class="form-control"
                                                    value="${formatDateInputValue(server.premiumJoinedAt)}"
                                                    style="height: 30px; max-width: 170px; padding: 4px 8px; font-size: 12px;"
                                                />
                                                <button class="btn-sm btn-info" onclick="savePremiumJoinDate('${server.id}')">Save Join Date</button>
                                            </div>
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
 * Generate servers tab content
 */
async function generateServersTab(client) {
    const servers = client ? Array.from(client.guilds.cache.values()) : [];
    const totalServers = servers.length;
    const totalMembers = servers.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
    const avgMembers = totalServers > 0 ? Math.round(totalMembers / totalServers) : 0;
    const largeServers = servers.filter(g => (g.memberCount || 0) >= 500).length;

    return `
    <div class="tab-content" id="servers-tab">
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Server Management</h2>
                <p>Monitor and manage all Discord servers where the bot is currently active.</p>
            </div>
            <div class="header-actions">
                <button class="btn btn-primary btn-sm" onclick="refreshServers()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    Refresh Servers
                </button>
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom: 32px;">
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Servers</div>
                    <div class="stat-value">${totalServers.toLocaleString()}</div>
                    <div class="stat-change neutral">Active guilds</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Members</div>
                    <div class="stat-value">${totalMembers.toLocaleString()}</div>
                    <div class="stat-change positive">Combined reach</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Avg Members</div>
                    <div class="stat-value">${avgMembers.toLocaleString()}</div>
                    <div class="stat-change neutral">Per server</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Large Servers</div>
                    <div class="stat-value">${largeServers.toLocaleString()}</div>
                    <div class="stat-change neutral">500+ members</div>
                </div>
            </div>
        </div>

        <div class="content-card">
            <div class="card-header">
                <div class="card-title-group">
                    <h3 class="card-title"> Server Directory</h3>
                    <p class="card-subtitle">Comprehensive list of all connected servers</p>
                </div>
                <div class="card-actions">
                    <div class="search-wrapper" style="position: relative;">
                        <svg style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary);" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        <input type="text" class="form-control" id="serverSearch" placeholder="Search servers..." style="padding-left: 36px; min-width: 260px;" onkeyup="filterServersTable()" />
                    </div>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="data-table" id="serversTableMain">
                        <thead>
                            <tr>
                                <th>Server</th>
                                <th>Server ID</th>
                                <th style="text-align: center;">Members</th>
                                <th style="text-align: center;">Joined</th>
                                <th style="text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="serversTableBody">
                            ${servers.map(guild => {
                                const initial = (guild.name || '?').charAt(0).toUpperCase();
                                const joinedDate = guild.joinedAt ? new Date(guild.joinedAt) : null;
                                const joinedStr = joinedDate ? joinedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                                
                                return `
                                <tr data-server-id="${guild.id}" class="server-row">
                                    <td>
                                        <div class="server-info-cell">
                                            <div class="server-avatar-mini" style="background: var(--primary-light); color: var(--primary); width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">
                                                ${guild.iconURL() ? `<img src="${guild.iconURL({ size: 32 })}" style="width: 100%; height: 100%; border-radius: 8px; object-fit: cover;" />` : initial}
                                            </div>
                                            <div class="server-meta">
                                                <div class="server-name" style="font-weight: 600; color: var(--text-primary);">${guild.name || 'Unknown Server'}</div>
                                                <div class="server-owner" style="font-size: 11px; color: var(--text-tertiary);">Owner ID: ${guild.ownerId || 'Unknown'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td><code class="code-snippet" style="background: var(--bg-secondary); padding: 4px 8px; border-radius: 4px; font-size: 12px; border: 1px solid var(--border-color);">${guild.id}</code></td>
                                    <td style="text-align: center;">
                                        <span class="badge badge-secondary" style="font-family: monospace; font-size: 13px;">${(guild.memberCount || 0).toLocaleString()}</span>
                                    </td>
                                    <td style="text-align: center;">
                                        <div class="time-cell">
                                            <div class="time-main" style="font-size: 13px;">${joinedStr}</div>
                                        </div>
                                    </td>
                                    <td style="text-align: right;">
                                        <div class="action-buttons">
                                            <button class="btn-icon btn-outline" onclick="viewServer('${guild.id}')" title="View Details">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                            </button>
                                            <button class="btn-icon btn-danger" onclick="leaveServer('${guild.id}', '${guild.name.replace(/'/g, "\\'")}')" title="Leave Server">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `}).join('')}
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
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Activity Log</h2>
                <p>Track all system events, admin actions, and bot activities in real-time.</p>
            </div>
            <div class="header-actions">
                <button class="btn btn-outline btn-sm" onclick="window.location.reload()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path></svg>
                    Refresh Logs
                </button>
                <button class="btn btn-primary btn-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg>
                    Export
                </button>
            </div>
        </div>

        <div class="content-card">
            <div class="card-header">
                <div class="card-title-group">
                    <h3 class="card-title"> System Events</h3>
                    <p class="card-subtitle">Detailed audit trail of bot operations</p>
                </div>
                <div class="card-actions">
                    <div class="filter-group" style="display: flex; gap: 8px;">
                        <select class="form-control-sm" style="min-width: 160px; height: 36px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);">
                            <option>All Activities</option>
                            <option>Server Events</option>
                            <option>Translation Events</option>
                            <option>Admin Actions</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="card-body" style="padding: 0;">
                <div class="modern-timeline">
                    <div class="timeline-item info">
                        <div class="timeline-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                        </div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <span class="timeline-title">Server Joined</span>
                                <span class="timeline-time">14:32:45</span>
                            </div>
                            <div class="timeline-body">
                                New server <span class="highlight">"Coding Community"</span> (ID: 123456789)
                            </div>
                            <div class="timeline-footer">Feb 11, 2024</div>
                        </div>
                    </div>

                    <div class="timeline-item success">
                        <div class="timeline-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <span class="timeline-title">Translation Completed</span>
                                <span class="timeline-time">14:28:12</span>
                            </div>
                            <div class="timeline-body">
                                <span class="badge badge-info">EN -> ES</span> processed for server <span class="highlight">"Gaming Hub"</span>
                            </div>
                            <div class="timeline-footer">Feb 11, 2024</div>
                        </div>
                    </div>

                    <div class="timeline-item warning">
                        <div class="timeline-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        </div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <span class="timeline-title">Rate Limit Warning</span>
                                <span class="timeline-time">14:15:03</span>
                            </div>
                            <div class="timeline-body">
                                Server <span class="highlight">"Test Guild"</span> is approaching its daily translation limit.
                            </div>
                            <div class="timeline-footer">Feb 11, 2024</div>
                        </div>
                    </div>

                    <div class="timeline-item info">
                        <div class="timeline-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                        </div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <span class="timeline-title">Admin Action</span>
                                <span class="timeline-time">13:45:22</span>
                            </div>
                            <div class="timeline-body">
                                Premium subscription approved for server <span class="highlight">"Premium Guild"</span>.
                            </div>
                            <div class="timeline-footer">Feb 11, 2024</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card-footer" style="padding: 16px; border-top: 1px solid var(--border-color); text-align: center;">
                <button class="btn btn-outline btn-sm">Load More Activities</button>
            </div>
        </div>
    </div>

    <style>
        .modern-timeline {
            padding: 24px;
            position: relative;
        }
        .modern-timeline::before {
            content: '';
            position: absolute;
            left: 35px;
            top: 24px;
            bottom: 24px;
            width: 2px;
            background: var(--border-color);
            opacity: 0.5;
        }
        .timeline-item {
            display: flex;
            gap: 20px;
            margin-bottom: 32px;
            position: relative;
        }
        .timeline-item:last-child {
            margin-bottom: 0;
        }
        .timeline-icon {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--bg-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
            box-shadow: 0 0 0 4px var(--card-bg);
            border: 2px solid var(--border-color);
            flex-shrink: 0;
            color: var(--text-secondary);
        }
        .timeline-item.info .timeline-icon { border-color: var(--info); color: var(--info); }
        .timeline-item.success .timeline-icon { border-color: var(--success); color: var(--success); }
        .timeline-item.warning .timeline-icon { border-color: var(--warning); color: var(--warning); }
        .timeline-item.danger .timeline-icon { border-color: var(--danger); color: var(--danger); }

        .timeline-content {
            flex: 1;
            padding: 16px;
            background: var(--bg-secondary);
            border-radius: 12px;
            border: 1px solid var(--border-color);
            transition: transform var(--transition-fast);
        }
        .timeline-content:hover {
            transform: translateX(4px);
            background: var(--card-bg-alt);
        }
        .timeline-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .timeline-title {
            font-weight: 700;
            font-size: 14px;
            color: var(--text-primary);
        }
        .timeline-time {
            font-size: 12px;
            color: var(--text-tertiary);
            font-family: monospace;
        }
        .timeline-body {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        .timeline-footer {
            margin-top: 12px;
            font-size: 11px;
            color: var(--text-tertiary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .highlight {
            color: var(--text-primary);
            font-weight: 600;
        }
    </style>
    `;
}

/**
 * Generate feedback tab content
 */
async function generateFeedbackTab() {
    const [settings, feedbackEntries] = await Promise.all([
        databaseService.getFeedbackSettings(),
        databaseService.getRecentFeedback(300)
    ]);

    const totalResponses = feedbackEntries.length;
    const freeUsers = feedbackEntries.filter((entry) => entry?.answers?.planType === 'free').length;
    const paidUsers = feedbackEntries.filter((entry) => entry?.answers?.planType === 'paid').length;
    const recommendYes = feedbackEntries.filter((entry) => entry?.answers?.recommendScore === 'yes').length;
    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const rows = feedbackEntries.map((entry) => {
        const feedbackId = escapeHtml(String(entry._id || ''));
        const username = escapeHtml(entry.globalName || entry.username || 'Unknown User');
        const userId = escapeHtml(entry.userId || '-');
        const planType = (entry?.answers?.planType || 'free').toUpperCase();
        const dashboardExperience = (entry?.answers?.dashboardExperience || 'n/a').replace('_', ' ');
        const recommend = (entry?.answers?.recommendScore || 'n/a').toUpperCase();
        const reason = (entry?.answers?.usageReason || 'n/a').replace('_', ' ');
        const suggestion = entry?.answers?.improvementSuggestion
            ? escapeHtml(String(entry.answers.improvementSuggestion).trim())
            : '-';
        const submittedAt = entry?.createdAt
            ? new Date(entry.createdAt).toLocaleString()
            : '-';

        return `
            <tr data-feedback-id="${feedbackId}">
                <td>
                    <input type="checkbox" class="feedback-row-checkbox" value="${feedbackId}" onchange="syncFeedbackSelectionState()" />
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-weight: 700; color: var(--text-primary);">${username}</span>
                        <span style="font-size: 12px; color: var(--text-tertiary);">${userId}</span>
                    </div>
                </td>
                <td><span class="badge badge-info">${planType}</span></td>
                <td style="text-transform: capitalize;">${dashboardExperience}</td>
                <td>${recommend}</td>
                <td style="text-transform: capitalize;">${reason}</td>
                <td style="max-width: 320px; white-space: normal;">${suggestion}</td>
                <td>${submittedAt}</td>
            </tr>
        `;
    }).join('');

    return `
    <div class="tab-content" id="feedback-tab">
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>User Feedback</h2>
                <p>Collect lightweight product feedback from dashboard users and track upgrade opportunities.</p>
            </div>
            <div class="welcome-actions">
                <label class="toggle-label">
                    <input
                        type="checkbox"
                        id="feedbackCollectionToggle"
                        ${settings.feedbackCollectionEnabled ? 'checked' : ''}
                        onchange="toggleFeedbackCollection(this.checked)"
                    />
                    <span>Feedback popup ${settings.feedbackCollectionEnabled ? 'enabled' : 'disabled'}</span>
                </label>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon" style="background: var(--primary-light); color: var(--primary);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Responses</div>
                    <div class="stat-value">${totalResponses.toLocaleString()}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M5 5h9a4 4 0 010 8H9a4 4 0 000 8h10"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Paid Users</div>
                    <div class="stat-value">${paidUsers.toLocaleString()}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--info);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12V7a2 2 0 00-2-2h-5"></path><path d="M4 12v5a2 2 0 002 2h5"></path><path d="M14 9l-3-3-3 3"></path><path d="M10 15l3 3 3-3"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Free Users</div>
                    <div class="stat-value">${freeUsers.toLocaleString()}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Would Recommend</div>
                    <div class="stat-value">${recommendYes.toLocaleString()}</div>
                </div>
            </div>
        </div>

        <div class="content-card" style="margin-top: 24px;">
            <div class="card-header">
                <h3 class="card-title">Latest Responses</h3>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="btn btn-outline btn-sm" type="button" onclick="window.location.reload()">Refresh</button>
                    <button class="btn btn-outline btn-sm" type="button" onclick="deleteSelectedFeedback()">Delete Selected</button>
                    <button class="btn btn-danger btn-sm" type="button" onclick="deleteAllFeedback()">Delete All</button>
                    <span class="badge badge-info">${feedbackEntries.length} entries</span>
                </div>
            </div>
            <div class="card-body" style="padding: 0;">
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th style="width: 44px;">
                                    <input type="checkbox" id="feedbackSelectAll" onchange="toggleAllFeedbackRows(this.checked)" />
                                </th>
                                <th>User</th>
                                <th>Plan</th>
                                <th>Dashboard</th>
                                <th>Recommend</th>
                                <th>Reason</th>
                                <th>Suggestion</th>
                                <th>Submitted</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || '<tr><td colspan="8" style="text-align: center; padding: 36px; color: var(--text-tertiary);">No feedback submitted yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Generate payments tab content
 */
async function generatePaymentsTab() {
    const Payment = require('../../models/Payment');
    
    // Fetch payment statistics
    const [
        totalPayments,
        activeSubscriptions,
        activeTrials,
        monthlyPlans,
        yearlyPlans,
        recentPayments
    ] = await Promise.all([
        Payment.countDocuments({ status: { $in: ['completed', 'active', 'trial', 'pending', 'patreon'] } }),
        Payment.countDocuments({ status: 'active', planType: 'Monthly' }),
        Payment.countDocuments({ status: 'trial', isTrial: true }),
        Payment.countDocuments({ planType: 'Monthly', status: { $in: ['completed', 'active'] } }),
        Payment.countDocuments({ planType: 'Yearly', status: { $in: ['completed', 'active'] } }),
        Payment.find({ status: { $in: ['completed', 'active', 'trial', 'pending', 'patreon'] } })
            .sort({ paymentDate: -1 })
            .limit(50)
            .lean()
    ]);

    const estimatedRevenue = (monthlyPlans * 5) + (yearlyPlans * 50);

    // Format payment rows
    const paymentRows = recentPayments.map(payment => {
        const date = new Date(payment.paymentDate);
        const formattedDate = date.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const statusBadgeClass = {
            'completed': 'success',
            'active': 'success',
            'trial': 'info',
            'pending': 'warning',
            'patreon': 'primary',
            'cancelled': 'danger',
            'expired': 'secondary'
        }[payment.status] || 'secondary';

        const trialBadge = payment.isTrial ? 
            `<span class="badge badge-info" style="margin-left: 8px;">Trial</span>` : '';

        return `
            <tr>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-weight: 600; color: var(--text-primary);">${payment.discordUsername}</span>
                        <span style="font-size: 12px; color: var(--text-tertiary);">${payment.discordServerName}</span>
                    </div>
                </td>
                <td>
                    <span class="badge badge-${payment.planType === 'Monthly' ? 'primary' : 'warning'}">
                        ${payment.planName}
                    </span>
                    ${trialBadge}
                </td>
                <td><strong>${payment.price}</strong></td>
                <td><span class="badge badge-${statusBadgeClass}">${payment.status}</span></td>
                <td style="color: var(--text-secondary);">${formattedDate}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-icon" onclick="viewPaymentDetails('${payment.paymentId}')" title="View Details">
                            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" stroke-width="2"/>
                                <path d="M2 10s3-7 8-7 8 7 8 7-3 7-8 7-8-7-8-7z" stroke="currentColor" stroke-width="2"/>
                            </svg>
                        </button>
                        <button class="btn-icon btn-danger" onclick="deletePayment('${payment.paymentId}')" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                <path d="M7 9v6m6-6v6M4 7h12M5 7l1 10a2 2 0 002 2h4a2 2 0 002-2l1-10M9 7V4a1 1 0 011-1h0a1 1 0 011 1v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
    <div class="tab-content" id="payments-tab">
        <!-- Welcome Section -->
        <div class="welcome-section">
            <div class="welcome-text">
                <h2>Payment Tracking</h2>
                <p>Monitor subscriptions, trials, and revenue from your users.</p>
            </div>
            <div class="welcome-actions">
                <button class="btn btn-outline btn-sm" onclick="window.location.reload()">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M17 10a7 7 0 11-1.5-4.3M17 5v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Refresh Data
                </button>
                <button class="btn btn-primary btn-sm" onclick="exportPayments()">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M3 17v2h14v-2M10 3v12m0 0l-4-4m4 4l4-4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Export CSV
                </button>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 6v6l4 2"></path>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Total Payments</div>
                    <div class="stat-value">${totalPayments.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend positive">All time</span>
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: var(--primary-light); color: var(--primary);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Est. Monthly Revenue</div>
                    <div class="stat-value">$${estimatedRevenue.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend neutral">${monthlyPlans} monthly + ${yearlyPlans} yearly</span>
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--info);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Active Subscriptions</div>
                    <div class="stat-value">${activeSubscriptions.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend positive">Monthly plans</span>
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">Active Trials</div>
                    <div class="stat-value">${activeTrials.toLocaleString()}</div>
                    <div class="stat-footer">
                        <span class="trend neutral">7-day trials</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Filters -->
        <div class="card" style="margin-top: 24px; padding: 20px;">
            <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
                <div style="flex: 1; min-width: 200px;">
                    <input type="text" id="searchPayments" placeholder="Search username or server..." 
                        class="form-input" style="width: 100%;"
                        onkeyup="filterPayments()">
                </div>
                <select id="filterStatus" class="form-select" onchange="filterPayments()">
                    <option value="">All Statuses</option>
                    <option value="completed">Completed</option>
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="expired">Expired</option>
                </select>
                <select id="filterPlan" class="form-select" onchange="filterPayments()">
                    <option value="">All Plans</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Yearly">Yearly</option>
                </select>
            </div>
        </div>

        <!-- Payments Table -->
        <div class="card" style="margin-top: 24px; overflow: hidden;">
            <div class="card-header">
                <h3>Recent Payments</h3>
                <span class="badge badge-info">${recentPayments.length} records</span>
            </div>
            <div style="overflow-x: auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>User & Server</th>
                            <th>Plan</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="paymentsTableBody">
                        ${paymentRows || '<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-tertiary);">No payments found</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <style>
        .form-input, .form-select {
            padding: 10px 14px;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-size: 14px;
            transition: all var(--transition-fast);
        }
        .form-input:focus, .form-select:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px var(--primary-light);
        }
        .btn-icon {
            padding: 6px;
            border: none;
            background: var(--bg-secondary);
            color: var(--text-secondary);
            border-radius: 6px;
            cursor: pointer;
            transition: all var(--transition-fast);
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .btn-icon:hover {
            background: var(--primary-light);
            color: var(--primary);
        }
        .btn-icon.btn-danger:hover {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }
    </style>

    <script>
        function filterPayments() {
            const search = document.getElementById('searchPayments').value.toLowerCase();
            const status = document.getElementById('filterStatus').value;
            const plan = document.getElementById('filterPlan').value;
            
            // This is a simple client-side filter
            // For production, implement server-side filtering with pagination
            console.log('Filtering:', { search, status, plan });
        }

        function viewPaymentDetails(paymentId) {
            alert('Viewing details for payment: ' + paymentId);
            // Implement modal or details view
        }

        function deletePayment(paymentId) {
            if (confirm('Are you sure you want to delete this payment record?')) {
                fetch('/admin/api/payments/delete?paymentId=' + paymentId, {
                    method: 'DELETE'
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        window.location.reload();
                    } else {
                        alert('Error deleting payment: ' + data.error);
                    }
                })
                .catch(err => alert('Error: ' + err.message));
            }
        }

        function exportPayments() {
            window.open('/admin/api/payments/export', '_blank');
        }
    </script>
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
        case 'payments':
            tabContent = await generatePaymentsTab();
            break;
        case 'servers':
            tabContent = await generateServersTab(client);
            break;
        case 'feedback':
            tabContent = await generateFeedbackTab();
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
    generatePaymentsTab,
    generateServersTab,
    generateFeedbackTab
};


