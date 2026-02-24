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

// Add notification animations to styles
const notificationStyles = document.createElement('style');
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

// ===== Sidebar Management =====
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const mobileOverlay = document.getElementById('mobileOverlay');

// Load saved sidebar state
const savedSidebarState = localStorage.getItem('sidebarCollapsed') === 'true';
if (savedSidebarState && window.innerWidth >= 768) {
    sidebar?.classList.add('collapsed');
}

sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
    const isCollapsed = sidebar?.classList.contains('collapsed');
    localStorage.setItem('sidebarCollapsed', isCollapsed);
});

// Mobile menu toggle
mobileMenuToggle?.addEventListener('click', () => {
    sidebar?.classList.add('open');
    mobileOverlay?.classList.add('active');
});

mobileOverlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    mobileOverlay?.classList.remove('active');
});

// ===== Character Counter =====
const messageContent = document.getElementById('messageContent');
const charCount = document.getElementById('charCount');

messageContent?.addEventListener('input', () => {
    const count = messageContent.value.length;
    if (charCount) {
        charCount.textContent = count;
        charCount.parentElement.style.color = count > 1500 ? 'var(--danger)' : 'var(--text-secondary)';
    }
    updatePreview();
});

// ===== Message Template Functions =====
function updateMessageTemplate() {
    const messageType = document.getElementById('messageType')?.value;
    const messageTitle = document.getElementById('messageTitle');
    const messageContent = document.getElementById('messageContent');
    const messageColor = document.getElementById('messageColor');
    
    const templates = {
        announcement: {
            title: '📢 Important Announcement',
            content: 'We have an important announcement to share with you...',
            color: '#3498db'
        },
        update: {
            title: '🔄 Bot Update',
            content: 'AirTranslator has been updated with new features and improvements...',
            color: '#9b59b6'
        },
        maintenance: {
            title: '🔧 Scheduled Maintenance',
            content: 'We will be performing scheduled maintenance on...',
            color: '#ffa500'
        },
        feature: {
            title: '✨ New Feature',
            content: 'Check out our exciting new feature...',
            color: '#00ff88'
        },
        warning: {
            title: '⚠️ Important Notice',
            content: 'Please pay attention to this important information...',
            color: '#ff6b6b'
        },
        celebration: {
            title: '🎉 Celebration',
            content: 'We are excited to celebrate this milestone with you...',
            color: '#f39c12'
        }
    };
    
    if (messageType !== 'custom' && templates[messageType]) {
        const template = templates[messageType];
        if (messageTitle) messageTitle.value = template.title;
        if (messageContent) messageContent.value = template.content;
        if (messageColor) messageColor.value = template.color;
        updatePreview();
    }
}

// ===== Target Options =====
function updateTargetOptions() {
    const targetType = document.getElementById('targetType')?.value;
    const serverSelectGroup = document.getElementById('serverSelectGroup');
    
    if (targetType === 'specific') {
        if (serverSelectGroup) serverSelectGroup.style.display = 'block';
        loadServersList();
    } else {
        if (serverSelectGroup) serverSelectGroup.style.display = 'none';
    }
}

async function loadServersList() {
    const targetServer = document.getElementById('targetServer');
    if (!targetServer) return;
    
    try {
        const response = await fetch('/admin/servers', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const servers = await response.json();
            targetServer.innerHTML = servers.map(server => 
                `<option value="${server.id}">${server.name} (${server.memberCount} members)</option>`
            ).join('');
        }
    } catch (error) {
        console.error('Error loading servers:', error);
        targetServer.innerHTML = '<option value="">Failed to load servers</option>';
    }
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
        previewFooter.textContent = 'AirTranslator Bot • ' + new Date().toLocaleString();
    }
    if (embedPreview) {
        embedPreview.style.borderLeftColor = color;
    }
}

// ===== Message Sending =====
async function sendMessage() {
    const messageData = {
        target: document.getElementById('targetType')?.value || 'all',
        serverId: document.getElementById('targetServer')?.value,
        title: document.getElementById('messageTitle')?.value,
        content: document.getElementById('messageContent')?.value,
        color: document.getElementById('messageColor')?.value,
        includeFooter: document.getElementById('includeFooter')?.checked,
        urgentMessage: document.getElementById('urgentMessage')?.checked,
        sendAsText: document.getElementById('sendAsText')?.checked
    };
    
    if (!messageData.content) {
        alert('Please enter message content');
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
                                const statusIcon = detail.status === 'sent' ? '✅' : '❌';
                                
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
                            if (progressText) progressText.textContent = `✅ Completed! Sent: ${result.sent}, Failed: ${result.failed}`;
                            if (currentServerStatus) currentServerStatus.textContent = 'Broadcast Complete';
                        } else if (data.type === 'error') {
                            if (progressText) progressText.textContent = `❌ Error: ${data.message}`;
                        }
                    } catch (e) {
                        console.error('Error parsing SSE data:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error sending message:', error);
        if (progressText) progressText.textContent = '❌ Network error occurred';
    }
}

async function sendTestMessage() {
    alert('Test message functionality - Would send to test channel');
}

async function scheduleMessage() {
    const messageData = {
        target: document.getElementById('targetType')?.value || 'all',
        serverId: document.getElementById('targetServer')?.value,
        title: document.getElementById('messageTitle')?.value,
        content: document.getElementById('messageContent')?.value,
        color: document.getElementById('messageColor')?.value,
        includeFooter: document.getElementById('includeFooter')?.checked,
        urgentMessage: document.getElementById('urgentMessage')?.checked,
        sendAsText: document.getElementById('sendAsText')?.checked,
        schedule: document.getElementById('schedule')?.value,
        time: document.getElementById('scheduleTime')?.value,
        timezone: document.getElementById('timezone')?.value,
        customSchedule: document.getElementById('customSchedule')?.value
    };
    
    if (!messageData.content) {
        alert('Please enter message content');
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
            alert(`✅ Message scheduled successfully! Job ID: ${result.jobId}`);
        } else {
            alert(`❌ Failed to schedule message: ${result.message}`);
        }
    } catch (error) {
        console.error('Error scheduling message:', error);
        alert('❌ Error scheduling message');
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
            alert(`✅ Successfully left ${serverName}`);
            // Remove the row from the table
            const row = document.querySelector(`tr[data-server-id="${serverId}"]`);
            if (row) row.remove();
        } else {
            alert(`❌ Failed to leave server: ${result.message}`);
        }
    } catch (error) {
        console.error('Error leaving server:', error);
        alert('❌ Error leaving server');
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

// ===== Load Recent Votes on Page Load =====
if (document.getElementById('recentVotesTbody')) {
    setTimeout(() => refreshRecentVotes(true), 100);
}

// ===== Tab Navigation =====
const urlParams = new URLSearchParams(window.location.search);
const activeTab = urlParams.get('tab') || 'analytics';

// Highlight active nav item
document.querySelectorAll('.nav-item').forEach(item => {
    const tab = item.getAttribute('data-tab');
    if (tab === activeTab) {
        item.classList.add('active');
    } else {
        item.classList.remove('active');
    }
});

// ===== Auto-refresh for real-time data =====
if (activeTab === 'analytics') {
    // Refresh analytics every 30 seconds
    setInterval(() => {
        fetch('/admin/metrics', { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                // Update stat cards if needed
                console.log('Metrics refreshed:', data);
            })
            .catch(err => console.error('Error refreshing metrics:', err));
    }, 30000);
}

console.log('🚀 AirTranslator Admin Panel loaded successfully');

// ===== Utility Functions =====

// Debounce helper
function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
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
