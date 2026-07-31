// ===== Theme Management =====
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Load saved theme or default to light
const savedTheme = localStorage.getItem('adminTheme') || 'light';
html.setAttribute('data-theme', savedTheme);

themeToggle?.addEventListener('click', () => {
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('adminTheme', newTheme);
});

// ===== Notification System =====
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    const bgColors = {
        success: 'var(--success)',
        error: 'var(--danger)',
        warn: 'var(--warning)',
        info: 'var(--info)'
    };

    notification.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${bgColors[type] || bgColors.info};
        color: white;
        padding: 14px 20px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

if (!document.getElementById('admin-notification-keyframes')) {
    const notificationStyles = document.createElement('style');
    notificationStyles.id = 'admin-notification-keyframes';
    notificationStyles.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(notificationStyles);
}

// ===== Message Template Functions =====
const premiumBroadcastTemplate = {
    title: 'Premium Access',
    content: `Unlock Full Access - Only $5/month

Follow these simple steps:
1. Click the card button below or open the Patreon link: https://www.patreon.com/c/tsio/membership
2. Subscribe to the membership plan you like.
3. Come back to this Discord server and click the approval button to request access.
4. Type /premium to see your premium details.

Your subscription is securely handled by Patreon.com, and we do not process your payment details directly.

You will get a notification when your premium plan is enabled.`.trim(),
    color: '#9b59b6'
};

const unlimitedUsageBroadcastTemplate = {
    title: 'Unlimited Usage Offer',
    content: `Get the most out of our service by purchasing a **subscription** and enjoy **unlimited usage every month**.

 **Secure payment via our official Patreon pricing page:**
https://www.patreon.com/c/tsio/membership

 **Limited-Time Bonus:**
Subscribe now and claim a **FREE 7-day trial** (limited-time offer):
https://www.patreon.com/c/tsio/membership

 **Note:** If you've already subscribed, you can start using the service immediately.`.trim(),
    color: '#f59e0b'
};

let messagingServersCache = [];
let messagingServersLastLoadedAt = 0;
const selectedServerIds = new Set();

function updateMessageTemplate() {
    const messageType = document.getElementById('messageType')?.value;
    const messageTitle = document.getElementById('messageTitle');
    const messageContent = document.getElementById('messageContent');
    const messageColor = document.getElementById('messageColor');

    const templates = {
        announcement: {
            title: 'Important Announcement',
            content: 'We have an important announcement to share with you...',
            color: '#3498db'
        },
        update: {
            title: 'Bot Update',
            content: 'AirTranslator has been updated with new features and improvements...',
            color: '#9b59b6'
        },
        maintenance: {
            title: 'Scheduled Maintenance',
            content: 'We will be performing scheduled maintenance on...',
            color: '#ffa500'
        },
        feature: {
            title: 'New Feature',
            content: 'Check out our exciting new feature...',
            color: '#00ff88'
        },
        warning: {
            title: 'Important Notice',
            content: 'Please pay attention to this important information...',
            color: '#ff6b6b'
        },
        celebration: {
            title: 'Celebration',
            content: 'We are excited to celebrate this milestone with you...',
            color: '#f39c12'
        },
        premium: premiumBroadcastTemplate,
        unlimitedUsage: unlimitedUsageBroadcastTemplate
    };

    if (messageType !== 'custom' && templates[messageType]) {
        const template = templates[messageType];
        if (messageTitle) messageTitle.value = template.title;
        if (messageContent) messageContent.value = template.content;
        if (messageColor) messageColor.value = template.color;
        updatePreview();
    }
}

function loadPremiumMessageTemplate() {
    const messageType = document.getElementById('messageType');
    const targetType = document.getElementById('targetType');
    const includeFooter = document.getElementById('includeFooter');
    const urgentMessage = document.getElementById('urgentMessage');
    const sendAsText = document.getElementById('sendAsText');

    if (messageType) messageType.value = 'premium';
    if (targetType) targetType.value = 'all';
    if (includeFooter) includeFooter.checked = true;
    if (urgentMessage) urgentMessage.checked = false;
    if (sendAsText) sendAsText.checked = false;

    updateMessageTemplate();
    updateTargetOptions();

    const titleInput = document.getElementById('messageTitle');
    if (titleInput) titleInput.focus();
}

function loadUnlimitedUsageMessageTemplate() {
    const messageType = document.getElementById('messageType');
    const targetType = document.getElementById('targetType');
    const includeFooter = document.getElementById('includeFooter');
    const urgentMessage = document.getElementById('urgentMessage');
    const sendAsText = document.getElementById('sendAsText');

    if (messageType) messageType.value = 'unlimitedUsage';
    if (targetType) targetType.value = 'all';
    if (includeFooter) includeFooter.checked = true;
    if (urgentMessage) urgentMessage.checked = false;
    if (sendAsText) sendAsText.checked = false;

    updateMessageTemplate();
    updateTargetOptions();

    const titleInput = document.getElementById('messageTitle');
    if (titleInput) titleInput.focus();
}

function clearMessageForm() {
    const messageType = document.getElementById('messageType');
    const messageTitle = document.getElementById('messageTitle');
    const messageContent = document.getElementById('messageContent');
    const messageColor = document.getElementById('messageColor');
    const targetType = document.getElementById('targetType');
    const includeFooter = document.getElementById('includeFooter');
    const urgentMessage = document.getElementById('urgentMessage');
    const sendAsText = document.getElementById('sendAsText');
    const sendingProgress = document.getElementById('sendingProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const currentServerStatus = document.getElementById('currentServerStatus');
    const detailedLogBody = document.getElementById('detailedLogBody');
    const successCount = document.getElementById('successCount');
    const failCount = document.getElementById('failCount');

    if (messageType) messageType.value = 'custom';
    if (messageTitle) messageTitle.value = '';
    if (messageContent) messageContent.value = '';
    if (messageColor) messageColor.value = '#3498db';
    if (targetType) targetType.value = 'all';
    if (includeFooter) includeFooter.checked = true;
    if (urgentMessage) urgentMessage.checked = false;
    if (sendAsText) sendAsText.checked = false;

    selectedServerIds.clear();
    const selectedServerSearch = document.getElementById('selectedServerSearch');
    const selectedMinMembers = document.getElementById('selectedMinMembers');
    const selectedMaxMembers = document.getElementById('selectedMaxMembers');
    const selectedJoinedAfter = document.getElementById('selectedJoinedAfter');
    const selectedJoinedBefore = document.getElementById('selectedJoinedBefore');
    const excludeExemptServers = document.getElementById('excludeExemptServers');

    if (selectedServerSearch) selectedServerSearch.value = '';
    if (selectedMinMembers) selectedMinMembers.value = '';
    if (selectedMaxMembers) selectedMaxMembers.value = '';
    if (selectedJoinedAfter) selectedJoinedAfter.value = '';
    if (selectedJoinedBefore) selectedJoinedBefore.value = '';
    if (excludeExemptServers) excludeExemptServers.checked = false;

    if (sendingProgress) sendingProgress.style.display = 'none';
    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = 'Preparing to send...';
    if (currentServerStatus) currentServerStatus.textContent = '';
    if (detailedLogBody) detailedLogBody.innerHTML = '';
    if (successCount) successCount.textContent = '0';
    if (failCount) failCount.textContent = '0';

    updateTargetOptions();
    updatePreview();
}

async function sendPremiumMessage() {
    loadPremiumMessageTemplate();

    const shouldSend = confirm('Send the premium campaign message now?');
    if (!shouldSend) return;

    await sendMessage();
}

async function sendUnlimitedUsageMessage() {
    loadUnlimitedUsageMessageTemplate();

    const shouldSend = confirm('Send the unlimited usage offer now?');
    if (!shouldSend) return;

    await sendMessage();
}

// ===== Target Options =====
function updateTargetOptions() {
    const targetType = document.getElementById('targetType')?.value;
    const serverSelectGroup = document.getElementById('serverSelectGroup');
    const selectedServersGroup = document.getElementById('selectedServersGroup');

    if (targetType === 'specific') {
        if (serverSelectGroup) serverSelectGroup.style.display = 'block';
        if (selectedServersGroup) selectedServersGroup.style.display = 'none';
        loadServersList();
    } else if (targetType === 'selected') {
        if (serverSelectGroup) serverSelectGroup.style.display = 'none';
        if (selectedServersGroup) selectedServersGroup.style.display = 'block';
        loadServersList();
    } else {
        if (serverSelectGroup) serverSelectGroup.style.display = 'none';
        if (selectedServersGroup) selectedServersGroup.style.display = 'none';
    }
}

function escapeHtml(value) {
    return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDateInput(value, endOfDay = false) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }
    return date;
}

function formatJoinedAt(joinedAt) {
    if (!joinedAt) return 'unknown join date';
    const date = new Date(joinedAt);
    if (Number.isNaN(date.getTime())) return 'unknown join date';
    return date.toLocaleDateString();
}

function getSelectedServerFilters() {
    const search = (document.getElementById('selectedServerSearch')?.value || '').trim().toLowerCase();
    const minMembers = Number(document.getElementById('selectedMinMembers')?.value || 0) || 0;
    const maxRaw = document.getElementById('selectedMaxMembers')?.value;
    const maxMembers = maxRaw === '' || maxRaw === null || maxRaw === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(maxRaw) || 0);
    const joinedAfter = parseDateInput(document.getElementById('selectedJoinedAfter')?.value, false);
    const joinedBefore = parseDateInput(document.getElementById('selectedJoinedBefore')?.value, true);
    const excludeExemptServers = document.getElementById('excludeExemptServers')?.checked === true;

    return {
        search,
        minMembers,
        maxMembers,
        joinedAfter,
        joinedBefore,
        excludeExemptServers
    };
}

function filterServersForSelection(servers) {
    const filters = getSelectedServerFilters();

    return servers.filter((server) => {
        const name = String(server.name || '').toLowerCase();
        const memberCount = Number(server.memberCount || 0);
        const joinedDate = server.joinedAt ? new Date(server.joinedAt) : null;
        const isExempt = server?.isExempt === true;

        if (filters.search && !name.includes(filters.search)) {
            return false;
        }

        if (filters.excludeExemptServers && isExempt) {
            return false;
        }

        if (memberCount < filters.minMembers || memberCount > filters.maxMembers) {
            return false;
        }

        if (filters.joinedAfter) {
            if (!joinedDate || Number.isNaN(joinedDate.getTime()) || joinedDate < filters.joinedAfter) {
                return false;
            }
        }

        if (filters.joinedBefore) {
            if (!joinedDate || Number.isNaN(joinedDate.getTime()) || joinedDate > filters.joinedBefore) {
                return false;
            }
        }

        return true;
    });
}

function getFilteredSelectedServerIds() {
    const allIds = Array.from(selectedServerIds);
    const excludeExempt = document.getElementById('excludeExemptServers')?.checked === true;

    if (!excludeExempt || !Array.isArray(messagingServersCache) || messagingServersCache.length === 0) {
        return allIds;
    }

    const exemptIds = new Set(
        messagingServersCache
            .filter((server) => server?.isExempt === true)
            .map((server) => String(server.id))
    );

    return allIds.filter((id) => !exemptIds.has(String(id)));
}

function renderTargetServerOptions() {
    const targetServer = document.getElementById('targetServer');
    if (!targetServer) return;

    const currentValue = targetServer.value;
    const excludeExempt = document.getElementById('excludeExemptServers')?.checked === true;
    const visibleServers = (Array.isArray(messagingServersCache) ? messagingServersCache : []).filter((server) =>
        !(excludeExempt && server?.isExempt === true)
    );

    if (visibleServers.length === 0) {
        targetServer.innerHTML = '<option value="">No eligible servers found</option>';
        return;
    }

    targetServer.innerHTML = visibleServers.map((server) =>
        `<option value="${server.id}">${escapeHtml(server.name)} (${Number(server.memberCount || 0).toLocaleString()} members)</option>`
    ).join('');

    if (currentValue && visibleServers.some((server) => String(server.id) === String(currentValue))) {
        targetServer.value = currentValue;
    }
}

function handleExcludeExemptServersChange() {
    const excludeExempt = document.getElementById('excludeExemptServers')?.checked === true;
    if (excludeExempt) {
        const exemptIds = new Set(
            (Array.isArray(messagingServersCache) ? messagingServersCache : [])
                .filter((server) => server?.isExempt === true)
                .map((server) => String(server.id))
        );
        Array.from(selectedServerIds).forEach((id) => {
            if (exemptIds.has(String(id))) {
                selectedServerIds.delete(String(id));
            }
        });
    }

    renderTargetServerOptions();
    renderSelectedServersList();
}

function toggleSelectedServerSelection(serverId, checked) {
    const normalizedId = String(serverId || '');
    if (!normalizedId) return;

    if (checked) {
        selectedServerIds.add(normalizedId);
    } else {
        selectedServerIds.delete(normalizedId);
    }

    renderSelectedServersList();
}

function selectAllFilteredServers() {
    const filtered = filterServersForSelection(messagingServersCache);
    filtered.forEach((server) => selectedServerIds.add(String(server.id)));
    renderSelectedServersList();
}

function clearSelectedServers() {
    selectedServerIds.clear();
    renderSelectedServersList();
}

function renderSelectedServersList() {
    const selectedServersList = document.getElementById('selectedServersList');
    const selectedServersMeta = document.getElementById('selectedServersMeta');

    if (!selectedServersList || !selectedServersMeta) return;

    if (!Array.isArray(messagingServersCache) || messagingServersCache.length === 0) {
        selectedServersMeta.textContent = 'No servers available';
        selectedServersList.innerHTML = '<div class="selected-servers-empty">No servers found.</div>';
        return;
    }

    const filteredServers = filterServersForSelection(messagingServersCache);

    selectedServersMeta.textContent = `${selectedServerIds.size} selected - ${filteredServers.length} visible of ${messagingServersCache.length}`;

    if (filteredServers.length === 0) {
        selectedServersList.innerHTML = '<div class="selected-servers-empty">No servers match the active filters.</div>';
        return;
    }

    selectedServersList.innerHTML = filteredServers
        .map((server) => {
            const id = String(server.id || '');
            const checked = selectedServerIds.has(id) ? 'checked' : '';
            const exemptTag = server?.isExempt === true ? ' - Exempt' : '';
            return `
                <label class="selected-server-item">
                    <input type="checkbox" ${checked} onchange="toggleSelectedServerSelection('${id}', this.checked)" />
                    <div class="selected-server-content">
                        <div class="selected-server-name">${escapeHtml(server.name)}</div>
                        <div class="selected-server-subtext">${Number(server.memberCount || 0).toLocaleString()} members - Joined ${formatJoinedAt(server.joinedAt)}${exemptTag}</div>
                    </div>
                </label>
            `;
        })
        .join('');
}

async function loadServersList({ force = false } = {}) {
    const now = Date.now();

    if (!force && Array.isArray(messagingServersCache) && messagingServersCache.length > 0 && (now - messagingServersLastLoadedAt) < 45000) {
        renderTargetServerOptions();
        renderSelectedServersList();
        return messagingServersCache;
    }
    
    try {
        const response = await fetch('/admin/servers', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const servers = await response.json();
            messagingServersCache = (Array.isArray(servers) ? servers : [])
                .map((server) => ({
                    ...server,
                    memberCount: Number(server.memberCount || 0),
                    isExempt: server?.isExempt === true
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            messagingServersLastLoadedAt = now;

            renderTargetServerOptions();
            renderSelectedServersList();
            return messagingServersCache;
        }
    } catch (error) {
        console.error('Error loading servers:', error);
        const targetServer = document.getElementById('targetServer');
        if (targetServer) targetServer.innerHTML = '<option value="">Failed to load servers</option>';
        const selectedServersList = document.getElementById('selectedServersList');
        if (selectedServersList) {
            selectedServersList.innerHTML = '<div class="selected-servers-empty">Failed to load servers.</div>';
        }
    }

    return [];
}

// ===== Schedule Options =====
function updateScheduleOptions() {
    const schedule = document.getElementById('schedule')?.value;
    const customScheduleGroup = document.getElementById('customScheduleGroup');
    const timeSelectionGroup = document.getElementById('timeSelectionGroup');
    
    if (schedule === 'custom') {
        if (customScheduleGroup) customScheduleGroup.style.display = 'block';
        if (timeSelectionGroup) timeSelectionGroup.style.display = 'none';
    } else if (schedule === 'now') {
        if (customScheduleGroup) customScheduleGroup.style.display = 'none';
        if (timeSelectionGroup) timeSelectionGroup.style.display = 'none';
    } else {
        if (customScheduleGroup) customScheduleGroup.style.display = 'none';
        if (timeSelectionGroup) timeSelectionGroup.style.display = 'block';
    }
}

// ===== Preview Functions =====
function updatePreview() {
    const title = document.getElementById('messageTitle')?.value || 'Title will appear here';
    const content = document.getElementById('messageContent')?.value || 'Message content will appear here';
    const color = document.getElementById('messageColor')?.value || '#3498db';
    const includeFooter = document.getElementById('includeFooter')?.checked;
    
    const previewTitle = document.getElementById('previewTitle');
    const previewContent = document.getElementById('previewContent');
    const previewFooter = document.getElementById('previewFooter');
    const embedPreview = document.querySelector('.embed-preview');
    
    if (previewTitle) previewTitle.textContent = title;
    if (previewContent) previewContent.textContent = content;
    if (previewFooter) {
        previewFooter.style.display = includeFooter ? 'block' : 'none';
        previewFooter.textContent = 'AirTranslator Bot - ' + new Date().toLocaleString();
    }
    if (embedPreview) {
        embedPreview.style.borderLeftColor = color;
    }
}

// ===== Message Sending =====
async function sendMessage() {
    const filteredSelectedServerIds = getFilteredSelectedServerIds();
    const messageData = {
        target: document.getElementById('targetType')?.value || 'all',
        serverId: document.getElementById('targetServer')?.value,
        selectedServerIds: filteredSelectedServerIds,
        title: document.getElementById('messageTitle')?.value,
        content: document.getElementById('messageContent')?.value,
        color: document.getElementById('messageColor')?.value,
        includeFooter: document.getElementById('includeFooter')?.checked,
        urgentMessage: document.getElementById('urgentMessage')?.checked,
        sendAsText: document.getElementById('sendAsText')?.checked,
        sendAsV2Container: document.getElementById('sendAsV2Container')?.checked
    };
    
    if (!messageData.content) {
        alert('Please enter message content');
        return;
    }

    if (messageData.target === 'specific' && !messageData.serverId) {
        alert('Please select a server for Specific Server targeting.');
        return;
    }

    if (messageData.target === 'selected' && messageData.selectedServerIds.length === 0) {
        alert('Select at least one server in Selected Servers mode.');
        return;
    }
    
    const sendingProgress = document.getElementById('sendingProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const currentServerStatus = document.getElementById('currentServerStatus');
    const detailedLogBody = document.getElementById('detailedLogBody');
    const successCount = document.getElementById('successCount');
    const failCount = document.getElementById('failCount');
    
    if (sendingProgress) sendingProgress.style.display = 'block';
    if (progressText) progressText.textContent = 'Initializing broadcast...';
    if (progressFill) progressFill.style.width = '0%';
    if (currentServerStatus) currentServerStatus.textContent = '';
    if (detailedLogBody) detailedLogBody.innerHTML = '';
    if (successCount) successCount.textContent = '0';
    if (failCount) failCount.textContent = '0';
    
    try {
        const response = await fetch('/admin/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(messageData)
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop(); // Keep the last incomplete chunk

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'connected') {
                            if (progressText) progressText.textContent = 'Connected, starting delivery...';
                            if (progressFill) progressFill.style.width = '5%';
                        } else if (data.type === 'start') {
                            if (currentServerStatus) currentServerStatus.textContent = `Sending to: ${data.serverName}`;
                        } else if (data.type === 'finish') {
                            const detail = data.detail;
                            
                            // Update counts
                            if (detail.status === 'sent') {
                                if (successCount) successCount.textContent = parseInt(successCount.textContent || '0') + 1;
                            } else {
                                if (failCount) failCount.textContent = parseInt(failCount.textContent || '0') + 1;
                            }
                            
                            // Add row to log
                            if (detailedLogBody) {
                                const row = document.createElement('tr');
                                row.style.borderBottom = '1px solid var(--border-color)';
                                const statusColor = detail.status === 'sent' ? 'var(--success)' : 'var(--danger)';
                                const statusIcon = detail.status === 'sent' ? 'OK' : 'ERR';
                                
                                row.innerHTML = `
                                    <td style="padding: 8px;">${detail.serverName}</td>
                                    <td style="padding: 8px; color: ${statusColor}; font-weight: 500;">${statusIcon} ${detail.status}</td>
                                    <td style="padding: 8px; color: var(--text-secondary); font-size: 0.85em;">${detail.channelName || detail.reason || '-'}</td>
                                `;
                                detailedLogBody.prepend(row);
                            }
                            
                            // Estimate progress (visual only since we don't know total easily in stream without extra packet)
                            // But we can just pulse or increment slightly
                            const currentWidth = parseFloat(progressFill.style.width) || 5;
                            if (currentWidth < 90) {
                                progressFill.style.width = `${currentWidth + 1}%`;
                            }
                        } else if (data.type === 'complete') {
                            const result = data.result;
                            if (progressFill) progressFill.style.width = '100%';
                            if (progressText) progressText.textContent = `Completed! Sent: ${result.sent}, Failed: ${result.failed}`;
                            if (currentServerStatus) currentServerStatus.textContent = 'Broadcast Complete';
                        } else if (data.type === 'error') {
                            if (progressText) progressText.textContent = `Error: ${data.message}`;
                        }
                    } catch (e) {
                        console.error('Error parsing SSE data:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error sending message:', error);
        if (progressText) progressText.textContent = 'Network error occurred';
    }
}

async function sendTestMessage() {
    alert('Test message functionality - Would send to test channel');
}

async function scheduleMessage() {
    const filteredSelectedServerIds = getFilteredSelectedServerIds();
    const messageData = {
        target: document.getElementById('targetType')?.value || 'all',
        serverId: document.getElementById('targetServer')?.value,
        selectedServerIds: filteredSelectedServerIds,
        title: document.getElementById('messageTitle')?.value,
        content: document.getElementById('messageContent')?.value,
        color: document.getElementById('messageColor')?.value,
        includeFooter: document.getElementById('includeFooter')?.checked,
        urgentMessage: document.getElementById('urgentMessage')?.checked,
        sendAsText: document.getElementById('sendAsText')?.checked,
        sendAsV2Container: document.getElementById('sendAsV2Container')?.checked,
        schedule: document.getElementById('schedule')?.value,
        time: document.getElementById('scheduleTime')?.value,
        timezone: document.getElementById('timezone')?.value,
        customSchedule: document.getElementById('customSchedule')?.value
    };
    
    if (!messageData.content) {
        alert('Please enter message content');
        return;
    }

    if (messageData.target === 'specific' && !messageData.serverId) {
        alert('Please select a server for Specific Server targeting.');
        return;
    }

    if (messageData.target === 'selected' && messageData.selectedServerIds.length === 0) {
        alert('Select at least one server in Selected Servers mode.');
        return;
    }
    
    try {
        const response = await fetch('/admin/schedule-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(messageData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Message scheduled successfully! Job ID: ${result.jobId}`);
        } else {
            alert(`Failed to schedule message: ${result.message}`);
        }
    } catch (error) {
        console.error('Error scheduling message:', error);
        alert('Error scheduling message');
    }
}

function notify(message, type = 'info') {
    if (typeof showNotification === 'function') {
        showNotification(message, type);
        return;
    }
    console.log(`[${type}] ${message}`);
}

function updateAutoCampaignStatus(enabled, triggerCount = 5) {
    const statusEl = document.getElementById('autoCampaignStatus');
    const triggerEl = document.getElementById('autoCampaignTriggerCount');
    if (triggerEl) triggerEl.textContent = String(triggerCount || 5);
    if (statusEl) {
        statusEl.textContent = enabled
            ? `Enabled: newly joined servers get the offer after ${triggerCount} translated messages.`
            : `Disabled: no auto offer will be sent to newly joined servers.`;
    }
}

async function loadAutoCampaignSettings() {
    const toggle = document.getElementById('autoUnlimitedCampaignEnabled');
    if (!toggle) return;

    try {
        const response = await fetch('/admin/messaging/campaign-settings', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`);
        }

        const data = await response.json();
        const enabled = Boolean(data.autoUnlimitedUsageCampaignEnabled);
        const triggerCount = Number(data.triggerCount || 5);

        toggle.checked = enabled;
        updateAutoCampaignStatus(enabled, triggerCount);
    } catch (error) {
        console.error('Error loading campaign settings:', error);
        updateAutoCampaignStatus(false, 5);
    }
}

async function toggleAutoUnlimitedCampaign(enabled) {
    const toggle = document.getElementById('autoUnlimitedCampaignEnabled');
    const previous = !enabled;

    try {
        const response = await fetch('/admin/messaging/campaign-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ autoUnlimitedUsageCampaignEnabled: enabled })
        });

        if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`);
        }

        const data = await response.json();
        const actualEnabled = Boolean(data.autoUnlimitedUsageCampaignEnabled);
        const triggerCount = Number(data.triggerCount || 5);

        if (toggle) toggle.checked = actualEnabled;
        updateAutoCampaignStatus(actualEnabled, triggerCount);
        notify(actualEnabled ? 'Auto campaign enabled' : 'Auto campaign disabled', 'success');
    } catch (error) {
        console.error('Error updating campaign settings:', error);
        if (toggle) toggle.checked = previous;
        updateAutoCampaignStatus(previous, 5);
        notify('Failed to update auto campaign setting', 'error');
    }
}

async function initializeMessagingTab() {
    await loadServersList({ force: true });
    updateTargetOptions();
    await loadAutoCampaignSettings();
    updatePreview();

    const messageContent = document.getElementById('messageContent');
    const charCount = document.getElementById('charCount');

    if (messageContent && charCount && !messageContent.dataset.charCountBound) {
        const updateCounter = () => {
            charCount.textContent = String((messageContent.value || '').length);
        };
        messageContent.addEventListener('input', updateCounter);
        messageContent.dataset.charCountBound = 'true';
        updateCounter();
    }
}

// ===== Server Management =====
async function refreshServers() {
    try {
        const response = await fetch('/admin/servers', {
            credentials: 'include'
        });
        
        if (response.ok) {
            location.reload();
        }
    } catch (error) {
        console.error('Error refreshing servers:', error);
    }
}

async function viewServer(serverId) {
    alert(`View server details: ${serverId}`);
    // Implement modal or redirect to server details page
}

async function leaveServer(serverId, serverName) {
    if (!confirm(`Are you sure you want to leave "${serverName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch('/admin/servers/leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ serverId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Successfully left ${serverName}`);
            // Remove the row from the table
            const row = document.querySelector(`tr[data-server-id="${serverId}"]`);
            if (row) row.remove();
        } else {
            alert(`Failed to leave server: ${result.message}`);
        }
    } catch (error) {
        console.error('Error leaving server:', error);
        alert('Error leaving server');
    }
}

// ===== Monetization Functions =====
async function refreshMonetization() {
    location.reload();
}



// ===== Utility Functions =====
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show a temporary toast notification
        const toast = document.createElement('div');
        toast.textContent = 'Copied to clipboard!';
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--success);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            z-index: 10000;
            animation: fadeIn 0.3s ease-out;
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// ===== Server Search =====
function filterServersTable() {
    const searchTerm = document.getElementById('serverSearch')?.value.toLowerCase();
    const rows = document.querySelectorAll('#serversTableBody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

const serverSearch = document.getElementById('serverSearch');
serverSearch?.addEventListener('input', debounce(filterServersTable, 150));

// ===== Server Sort =====
function sortServersTable() {
    const sortSelect = document.getElementById('serverSortSelect');
    if (!sortSelect) return;
    const sortValue = sortSelect.value;
    localStorage.setItem('adminServerSort', sortValue);

    const tbody = document.getElementById('serversTableBody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));

    const [field, direction] = sortValue.split('-');
    const dir = direction === 'asc' ? 1 : -1;

    rows.sort((a, b) => {
        let valA, valB;
        switch (field) {
            case 'joined':
                valA = parseInt(a.getAttribute('data-joined') || '0', 10);
                valB = parseInt(b.getAttribute('data-joined') || '0', 10);
                return (valA - valB) * dir;
            case 'members':
                valA = parseInt(a.getAttribute('data-member-count') || '0', 10);
                valB = parseInt(b.getAttribute('data-member-count') || '0', 10);
                return (valA - valB) * dir;
            case 'name':
                valA = (a.getAttribute('data-server-name') || '').toLowerCase();
                valB = (b.getAttribute('data-server-name') || '').toLowerCase();
                return valA.localeCompare(valB) * dir;
            default:
                return 0;
        }
    });

    rows.forEach(row => tbody.appendChild(row));
}

// Restore saved sort on page load
(function initServerSort() {
    const saved = localStorage.getItem('adminServerSort');
    const sortSelect = document.getElementById('serverSortSelect');
    if (saved && sortSelect) {
        sortSelect.value = saved;
    }
    // Apply sort on load
    if (sortSelect) {
        sortServersTable();
    }
})();

// ===== Load Recent Votes on Page Load =====
if (document.getElementById('recentVotesTbody')) {
    setTimeout(() => refreshRecentVotes(true), 100);
}

// ===== Tab Navigation =====
const urlParams = new URLSearchParams(window.location.search);
const activeTab = urlParams.get('tab') || 'analytics';
let latestAllLanguages = [];

// Highlight active nav item
document.querySelectorAll('.nav-item').forEach(item => {
    const tab = item.getAttribute('data-tab');
    if (tab === activeTab) {
        item.classList.add('active');
    } else {
        item.classList.remove('active');
    }
});

if (activeTab === 'messaging') {
    setTimeout(() => {
        initializeMessagingTab().catch((error) => {
            console.error('Error initializing messaging tab:', error);
        });
    }, 50);
}

if (activeTab === 'feedback') {
    setTimeout(() => {
        syncFeedbackSelectionState();
    }, 40);
}

function getLanguageMeta(code) {
    const languageMap = {
        en: { name: 'English', flag: 'EN' },
        es: { name: 'Spanish', flag: 'ES' },
        fr: { name: 'French', flag: 'FR' },
        de: { name: 'German', flag: 'DE' },
        it: { name: 'Italian', flag: 'IT' },
        pt: { name: 'Portuguese', flag: 'PT' },
        ja: { name: 'Japanese', flag: 'JA' },
        ko: { name: 'Korean', flag: 'KO' },
        zh: { name: 'Chinese', flag: 'ZH' },
        ru: { name: 'Russian', flag: 'RU' },
        ar: { name: 'Arabic', flag: 'AR' },
        hi: { name: 'Hindi', flag: 'HI' },
        ur: { name: 'Urdu', flag: 'UR' },
        tr: { name: 'Turkish', flag: 'TR' },
        nl: { name: 'Dutch', flag: 'NL' },
        pl: { name: 'Polish', flag: 'PL' },
        vi: { name: 'Vietnamese', flag: 'VI' },
        id: { name: 'Indonesian', flag: 'ID' },
        uk: { name: 'Ukrainian', flag: 'UK' },
        ro: { name: 'Romanian', flag: 'RO' },
        fa: { name: 'Persian', flag: 'FA' },
        bn: { name: 'Bengali', flag: 'BN' }
    };

    const normalized = (code || '').toLowerCase();
    return languageMap[normalized] || { name: normalized.toUpperCase() || 'Unknown', flag: 'NA' };
}

function renderTopLanguages(topLanguages = [], totalLanguageUsages = 0) {
    const container = document.getElementById('top-languages-list');
    if (!container) return;

    const totalLabel = document.getElementById('languages-live-total');
    if (totalLabel) {
        totalLabel.textContent = `${(Number(totalLanguageUsages) || 0).toLocaleString()} tracked`;
    }

    if (!Array.isArray(topLanguages) || topLanguages.length === 0) {
        container.innerHTML = '<div class="lang-empty-state">No translation activity yet. Language popularity will appear here after usage starts.</div>';
        return;
    }

    container.innerHTML = topLanguages.map((item) => {
        const meta = getLanguageMeta(item.code);
        const count = Number(item.count) || 0;
        const percentage = Math.max(0, Number(item.percentage) || 0);
        const width = Math.max(6, Math.min(100, percentage));
        return `
            <div class="lang-item" data-lang-code="${item.code}">
                <div class="lang-meta">
                    <span class="lang-flag">${meta.flag}</span>
                    <span class="lang-name">${meta.name}</span>
                    <span class="lang-count">${count.toLocaleString()}</span>
                    <span class="lang-percent">${percentage.toFixed(1)}%</span>
                </div>
                <div class="lang-progress">
                    <div class="lang-bar" style="width: ${width}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

function showAllLanguagesModal() {
    const modal = document.getElementById('languagesDetailsModal');
    const overlay = document.getElementById('languagesModalOverlay');
    const tbody = document.getElementById('allLanguagesTableBody');

    if (!modal || !overlay || !tbody) return;

    if (!Array.isArray(latestAllLanguages) || latestAllLanguages.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 24px; color: var(--text-tertiary);">
                    No language activity found yet.
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = latestAllLanguages.map((item) => {
            const meta = getLanguageMeta(item.code);
            const count = Number(item.count) || 0;
            const percentage = Math.max(0, Number(item.percentage) || 0);
            const safeCode = escapeHtml(item.code);
            const safeName = escapeHtml(meta.name);
            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span>${meta.flag}</span>
                            <span>${safeName}</span>
                        </div>
                    </td>
                    <td><code class="code-snippet">${safeCode}</code></td>
                    <td>${count.toLocaleString()}</td>
                    <td>${percentage.toFixed(1)}%</td>
                </tr>
            `;
        }).join('');
    }

    overlay.classList.add('active');
    modal.classList.add('active');
}

function hideAllLanguagesModal() {
    const modal = document.getElementById('languagesDetailsModal');
    const overlay = document.getElementById('languagesModalOverlay');
    if (!modal || !overlay) return;

    overlay.classList.remove('active');
    modal.classList.remove('active');
}

async function refreshAnalyticsMetrics() {
    const response = await fetch('/admin/metrics', { credentials: 'include' });
    if (!response.ok) {
        throw new Error(`metrics request failed with ${response.status}`);
    }
    const data = await response.json();
    latestAllLanguages = Array.isArray(data.allLanguages) ? data.allLanguages : [];
    renderTopLanguages(data.topLanguages || [], data.totalLanguageUsages || 0);
}

// ===== Auto-refresh for real-time data =====
if (activeTab === 'analytics') {
    refreshAnalyticsMetrics().catch(err => console.error('Error refreshing metrics:', err));
    setInterval(() => {
        refreshAnalyticsMetrics().catch(err => console.error('Error refreshing metrics:', err));
    }, 30000);
}

console.log('AirTranslator Admin Panel loaded successfully');

// ===== Utility Functions =====

// Debounce helper
function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

async function toggleFeedbackCollection(enabled) {
    try {
        const response = await fetch('/admin/feedback/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                feedbackCollectionEnabled: !!enabled
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to update feedback settings');
        }

        const toggle = document.getElementById('feedbackCollectionToggle');
        const labelText = toggle?.closest('.toggle-label')?.querySelector('span');
        if (labelText) {
            labelText.textContent = `Feedback popup ${enabled ? 'enabled' : 'disabled'}`;
        }

        showNotification(`Feedback popup ${enabled ? 'enabled' : 'disabled'} successfully`, 'success');
    } catch (error) {
        console.error('Failed to update feedback settings:', error);
        const toggle = document.getElementById('feedbackCollectionToggle');
        if (toggle) toggle.checked = !enabled;
        showNotification('Could not update feedback setting', 'error');
    }
}

function toggleAllFeedbackRows(checked) {
    const rowCheckboxes = document.querySelectorAll('.feedback-row-checkbox');
    rowCheckboxes.forEach((checkbox) => {
        checkbox.checked = !!checked;
    });
    syncFeedbackSelectionState();
}

function syncFeedbackSelectionState() {
    const master = document.getElementById('feedbackSelectAll');
    const rowCheckboxes = Array.from(document.querySelectorAll('.feedback-row-checkbox'));
    if (!master || rowCheckboxes.length === 0) return;

    const selectedCount = rowCheckboxes.filter((checkbox) => checkbox.checked).length;
    master.checked = selectedCount > 0 && selectedCount === rowCheckboxes.length;
    master.indeterminate = selectedCount > 0 && selectedCount < rowCheckboxes.length;
}

function getSelectedFeedbackIds() {
    return Array.from(document.querySelectorAll('.feedback-row-checkbox:checked'))
        .map((checkbox) => String(checkbox.value || '').trim())
        .filter(Boolean);
}

async function deleteSelectedFeedback() {
    const feedbackIds = getSelectedFeedbackIds();
    if (feedbackIds.length === 0) {
        showNotification('Select at least one feedback entry', 'warn');
        return;
    }

    const confirmed = confirm(`Delete ${feedbackIds.length} selected feedback entries?`);
    if (!confirmed) return;

    try {
        const response = await fetch('/admin/feedback/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ feedbackIds })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Delete failed');
        }

        showNotification(`Deleted ${Number(data.deletedCount || 0)} feedback entries`, 'success');
        setTimeout(() => window.location.reload(), 450);
    } catch (error) {
        console.error('Failed to delete selected feedback:', error);
        showNotification('Failed to delete selected feedback', 'error');
    }
}

async function deleteAllFeedback() {
    const confirmed = confirm('Delete all feedback entries? This cannot be undone.');
    if (!confirmed) return;

    try {
        const response = await fetch('/admin/feedback/delete-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Delete all failed');
        }

        showNotification(`Deleted ${Number(data.deletedCount || 0)} feedback entries`, 'success');
        setTimeout(() => window.location.reload(), 450);
    } catch (error) {
        console.error('Failed to delete all feedback:', error);
        showNotification('Failed to delete all feedback', 'error');
    }
}

// ===== Monetization Functions =====

// Save global settings
async function saveGlobalSettings() {
    const freeLimit = document.getElementById('freeLimit')?.value;
    const globalRestriction = document.getElementById('globalRestriction')?.checked;
    
    try {
        const res = await fetch('/admin/monetization/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                defaultFreeTranslationLimit: parseInt(freeLimit),
                enableGlobalRestriction: globalRestriction
            })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Global settings saved successfully', 'success');
        } else {
            showNotification('Failed to save settings: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('Error saving settings', 'error');
    }
}

// Save vote bonus amount
async function saveVoteBonusAmount() {
    const amount = document.getElementById('voteBonusAmount')?.value;
    if (!amount || parseInt(amount) < 1) {
        showNotification('Please enter a valid amount (1-1000)', 'error');
        return;
    }
    try {
        const res = await fetch('/admin/vote-bonus-amount', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ amount: parseInt(amount) })
        });
        const data = await res.json();
        if (data.success) {
            showNotification(`Vote bonus updated to ${data.amount} translations`, 'success');
        } else {
            showNotification('Failed to save: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error saving vote bonus amount:', error);
        showNotification('Error saving vote bonus amount', 'error');
    }
}

// Add exempt server
async function addExemptServer(serverId) {
    const serverIdInput = document.getElementById('serverIdInput');
    const id = serverId || serverIdInput?.value?.trim();
    
    if (!id) {
        showNotification('Please enter a server ID', 'error');
        return;
    }
    
    const days = prompt('Enter duration in days (or leave blank for unlimited):', '30');
    if (days === null) return;
    
    const durationDays = days.trim() === '' ? null : parseInt(days);
    
    try {
        const res = await fetch('/admin/monetization/exempt/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serverId: id, durationDays })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Server added to exempt list', 'success');
            if (serverIdInput) serverIdInput.value = '';
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error adding exempt server:', error);
        showNotification('Error adding exempt server', 'error');
    }
}

// Remove exempt server
async function removeExemptServer(serverId) {
    if (!confirm('Remove this server from exempt list?')) return;
    
    try {
        const res = await fetch('/admin/monetization/exempt/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serverId })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Server removed from exempt list', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error removing exempt server:', error);
        showNotification('Error removing exempt server', 'error');
    }
}

// Add restricted server
async function addRestrictedServer(serverId) {
    const serverIdInput = document.getElementById('serverIdInput');
    const id = serverId || serverIdInput?.value?.trim();
    
    if (!id) {
        showNotification('Please enter a server ID', 'error');
        return;
    }
    
    try {
        const res = await fetch('/admin/monetization/restrict/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serverId: id })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Server added to restricted list', 'success');
            if (serverIdInput) serverIdInput.value = '';
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error adding restricted server:', error);
        showNotification('Error adding restricted server', 'error');
    }
}

// Reset server count
async function resetServerCount(serverId) {
    const serverIdInput = document.getElementById('serverIdInput');
    const id = serverId || serverIdInput?.value?.trim();
    
    if (!id) {
        showNotification('Please enter a server ID', 'error');
        return;
    }
    
    if (!confirm('Reset translation count for this server?')) return;
    
    try {
        const res = await fetch('/admin/monetization/reset-count', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serverId: id })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Server count reset successfully', 'success');
            if (serverIdInput) serverIdInput.value = '';
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error resetting count:', error);
        showNotification('Error resetting count', 'error');
    }
}

// Set custom limit
async function setCustomLimit() {
    const serverIdInput = document.getElementById('serverIdInput');
    const customLimitInput = document.getElementById('customLimitInput');
    
    const serverId = serverIdInput?.value?.trim();
    const customLimit = customLimitInput?.value?.trim();
    
    if (!serverId) {
        showNotification('Please enter a server ID', 'error');
        return;
    }
    
    if (!customLimit || parseInt(customLimit) < 1) {
        showNotification('Please enter a valid limit (1 or greater)', 'error');
        return;
    }
    
    try {
        const res = await fetch('/admin/monetization/custom-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serverId, customLimit: parseInt(customLimit) })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Custom limit set successfully', 'success');
            if (serverIdInput) serverIdInput.value = '';
            if (customLimitInput) customLimitInput.value = '';
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error setting custom limit:', error);
        showNotification('Error setting custom limit', 'error');
    }
}

// Save premium join date for a server (used to calculate monthly renewal date)
async function savePremiumJoinDate(serverId) {
    const input = document.getElementById(`premiumJoinDate_${serverId}`);
    if (!input) {
        showNotification('Join date input not found for this server', 'error');
        return;
    }

    const joinDate = (input.value || '').trim();

    if (!joinDate) {
        const shouldClear = confirm('No date selected. Do you want to clear the premium join date for this server?');
        if (!shouldClear) return;
    }

    try {
        const res = await fetch('/admin/monetization/premium/join-date', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                serverId,
                joinDate: joinDate || null
            })
        });

        const data = await res.json();
        if (data.success) {
            if (data.nextRenewalDate) {
                const nextRenewal = new Date(data.nextRenewalDate).toLocaleDateString();
                showNotification(`Premium join date saved. Next renewal: ${nextRenewal}`, 'success');
            } else {
                showNotification('Premium join date cleared', 'success');
            }
            setTimeout(() => window.location.reload(), 900);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error saving premium join date:', error);
        showNotification('Error saving premium join date', 'error');
    }
}

// Approve premium request
async function approvePremium(requestId, serverId) {
    try {
        const input = document.getElementById('dur_' + requestId);
        const days = parseInt(input && input.value ? input.value : '30', 10);
        
        const res = await fetch('/admin/monetization/premium/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ requestId, durationDays: isNaN(days) ? 30 : days })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Premium approved for ' + (data.serverName || serverId), 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed to approve: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('Error approving:', err);
        showNotification('Error approving request', 'error');
    }
}

// Reject premium request
async function rejectPremium(requestId, serverId) {
    try {
        const reason = prompt('Optional: Provide reason for rejection:', '');
        
        const res = await fetch('/admin/monetization/premium/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ requestId, reason: reason || null })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Premium request rejected for ' + (data.serverName || serverId), 'warn');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification('Failed to reject: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('Error rejecting:', err);
        showNotification('Error rejecting request', 'error');
    }
}

// Delete vote record
async function deleteVoteRecord(voteId) {
    if (!voteId) return;
    if (!confirm('Permanently delete this vote record?')) return;
    
    try {
        const res = await fetch('/admin/monetization/vote/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ voteId })
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification('Vote record deleted', 'success');
            await refreshRecentVotes(true);
        } else {
            showNotification('Failed to delete: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (e) {
        console.error('Error deleting vote:', e);
        showNotification('Error deleting vote', 'error');
    }
}

// Refresh recent votes
let voteFilterDebounce;
async function refreshRecentVotes(silent = false) {
    try {
        const statusEl = document.getElementById('voteStatusFilter');
        const serverEl = document.getElementById('voteServerFilter');
        const status = statusEl ? statusEl.value : 'all';
        const serverId = serverEl ? serverEl.value.trim() : '';
        const qs = new URLSearchParams({ ts: Date.now().toString(), status, serverId }).toString();
        
        const res = await fetch('/admin/monetization/recent-votes?' + qs, { 
            headers: { 'Accept': 'application/json' },
            credentials: 'include'
        });
        
        if (!res.ok) throw new Error('Failed to fetch');
        
        const payload = await res.json();
        if (!payload || !payload.success) throw new Error(payload?.message || 'Unknown error');
        
        const tbody = document.getElementById('recentVotesTbody');
        if (tbody) tbody.innerHTML = payload.tbody || '';
        
        const countEl = document.getElementById('recentActivityCount');
        if (countEl && typeof payload.count === 'number') countEl.textContent = payload.count;
        
        if (!silent) showNotification('Recent votes updated', 'success');
    } catch (err) {
        if (!silent) showNotification('Could not refresh votes: ' + err.message, 'error');
    }
}

// Handle vote server filter with debounce
function handleVoteServerFilter() {
    clearTimeout(voteFilterDebounce);
    voteFilterDebounce = setTimeout(() => refreshRecentVotes(true), 400);
}

// Clear vote filters
function clearVoteFilters() {
    const statusEl = document.getElementById('voteStatusFilter');
    const serverEl = document.getElementById('voteServerFilter');
    if (statusEl) statusEl.value = 'all';
    if (serverEl) serverEl.value = '';
    refreshRecentVotes(true);
}

// Bulk actions
async function bulkRestrictAll() {
    if (!confirm('Apply restrictions to ALL servers (except exempt)? This is a bulk action!')) return;
    
    try {
        const res = await fetch('/admin/monetization/bulk/restrict-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification(`Restrictions applied to ${data.affectedCount} servers`, 'success');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error in bulk restrict:', error);
        showNotification('Error applying restrictions', 'error');
    }
}

async function bulkRemoveRestrictions() {
    if (!confirm('Remove restrictions from ALL servers (except exempt)? This is a bulk action!')) return;
    
    try {
        const res = await fetch('/admin/monetization/bulk/remove-restrictions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification(`Restrictions removed from ${data.affectedCount} servers`, 'success');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error in bulk remove:', error);
        showNotification('Error removing restrictions', 'error');
    }
}

async function bulkResetCounts() {
    if (!confirm('Reset translation counts for ALL servers? This is a bulk action!')) return;
    
    try {
        const res = await fetch('/admin/monetization/bulk/reset-counts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        const data = await res.json();
        if (data.success) {
            showNotification(`Counts reset for ${data.affectedCount} servers`, 'success');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            showNotification('Failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error in bulk reset:', error);
        showNotification('Error resetting counts', 'error');
    }
}

// Search monetization servers
function searchMonetizationServers() {
    const input = document.getElementById('monetizationSearchInput');
    const filter = input ? input.value.toLowerCase() : '';
    const table = document.getElementById('monetizationServersTable');
    const rows = table ? table.getElementsByTagName('tr') : [];
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const text = row.textContent || row.innerText;
        row.style.display = text.toLowerCase().includes(filter) ? '' : 'none';
    }
}

// Filter servers by status
let currentFilter = 'all';
function filterServers(status) {
    currentFilter = status;
    const rows = document.querySelectorAll('#monetizationServersTable tbody tr.server-row');
    const buttons = document.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(status.replace('-', ' '))) {
            btn.classList.add('active');
        }
    });
    
    rows.forEach(row => {
        const rowStatus = row.getAttribute('data-status');
        if (status === 'all') {
            row.style.display = '';
        } else {
            row.style.display = rowStatus === status ? '' : 'none';
        }
    });
}

// Auto-refresh recent votes every 30s
if (document.getElementById('recentVotesTbody')) {
    setInterval(() => refreshRecentVotes(true), 30000);
}

// Initialize vote filter event listeners
function initializeVoteFilters() {
    const statusFilter = document.getElementById('voteStatusFilter');
    const serverFilter = document.getElementById('voteServerFilter');
    const clearFiltersBtn = document.getElementById('clearVoteFilters');
    
    if (statusFilter) {
        statusFilter.addEventListener('change', () => refreshRecentVotes(true));
    }
    
    if (serverFilter) {
        const debouncedFilter = debounce(() => refreshRecentVotes(true), 400);
        serverFilter.addEventListener('input', debouncedFilter);
    }
    
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (statusFilter) statusFilter.value = 'all';
            if (serverFilter) serverFilter.value = '';
            refreshRecentVotes(true);
        });
    }
}

// Initialize filters when monetization tab is active
if (new URLSearchParams(window.location.search).get('tab') === 'monetization') {
    // Wait for DOM to be ready
    setTimeout(() => initializeVoteFilters(), 100);
}


