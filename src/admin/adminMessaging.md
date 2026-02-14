# Messaging Tab - Complete Feature Documentation

## Overview
The Messaging tab provides a comprehensive interface for composing, previewing, and sending messages to Discord servers. It includes templates, scheduling, real-time preview, progress tracking, and auto-setup functionality.

---

## UI Sections

### 1. Compose Section
**Purpose:** Create and configure messages with advanced options

#### Message Type Selector
**Field:** `<select id="messageType">`
**Options:**
- Custom Message
- 📢 Announcement
- 🔄 Bot Update
- 🔧 Maintenance
- ✨ New Feature
- ⚠️ Important
- 🎉 Celebration

**Function:** `onChange="updateMessageTemplate()"`
- Auto-fills title and content based on selected template
- Provides starting point for common message types

#### Embed Color Selector
**Field:** `<select id="messageColor">`
**Options:**
- #3498db - Blue (Info)
- #00ff88 - Green (Success)
- #ffa500 - Orange (Warning)
- #ff6b6b - Red (Important)
- #9b59b6 - Purple (Feature)
- #f39c12 - Yellow (Announcement)

**Purpose:** Sets the color accent of Discord embed border

#### Title Field
**Field:** `<input type="text" id="messageTitle">`
**Attributes:**
- Placeholder: "e.g., Important Bot Update"
- maxlength: 100
- Optional

#### Content Field
**Field:** `<textarea id="messageContent">`
**Attributes:**
- rows: 6
- Placeholder: "Type your message here..."
- maxlength: 1500
- Character counter: `<span id="charCount">0</span> / 1500`

**Function:** Updates character count in real-time

#### Target Selection
**Field:** `<select id="targetType">`
**Options:**
- all - All Servers (Broadcast)
- specific - Specific Server
- large - Large Servers Only (1000+ members)
- active - Active Servers Only (recent activity)

**Function:** `onChange="updateTargetOptions()"`
- Shows/hides server selector based on selection
- Updates target badge in preview

#### Server Selector (Conditional)
**Field:** `<select id="targetServer">`
**Container:** `<div id="serverSelectGroup">` (hidden by default)
**Purpose:** Populated with server list when "specific" target is selected
**Data:** Fetched from Discord client guilds

#### Schedule Options
**Field:** `<select id="schedule">`
**Options:**
- now - Send Now
- daily - Daily
- weekly - Weekly
- monthly - Monthly
- custom - Custom Cron

**Function:** `onChange="updateScheduleOptions()"`
- Shows/hides time picker and custom cron input
- Updates schedule badge in preview

#### Time Picker (Conditional)
**Field:** `<input type="time" id="scheduleTime">`
**Container:** `<div id="timeSelectionGroup">`
**Default:** "12:00"
**Purpose:** Set specific time for scheduled messages

#### Custom Cron (Conditional)
**Field:** `<input type="text" id="customSchedule">`
**Container:** `<div id="customScheduleGroup">` (hidden by default)
**Placeholder:** "* * * * *"
**Hint:** "Cron: min hour day month day-of-week"
**Purpose:** Advanced scheduling with cron expressions

#### Timezone Selector
**Field:** `<select id="timezone">`
**Options:**
- UTC
- America/New_York - Eastern Time
- America/Chicago - Central Time
- America/Los_Angeles - Pacific Time
- Europe/London - London
- Asia/Kolkata - India (IST)

**Purpose:** Set timezone for scheduled messages

#### Options Checkboxes
**Fields:**
1. `<input type="checkbox" id="includeFooter" checked>`
   - Label: "Include footer & timestamp"
   - Default: checked

2. `<input type="checkbox" id="urgentMessage">`
   - Label: "Mark as urgent"
   - Adds urgent styling to embed

---

### 2. Preview Section
**Purpose:** Real-time embed preview as it will appear in Discord

#### Preview Card
**Structure:**
```html
<div class="embed embed-preview">
  <div id="previewTitle" class="e-title">Title will appear here</div>
  <div id="previewContent" class="e-desc">Message content will appear here</div>
  <div id="previewFooter" class="e-foot">AirTranslator Bot • Now</div>
</div>
```

**Features:**
- Live border color (synced with color selector)
- Title updates from title field
- Content updates from content field
- Footer shows/hides based on includeFooter checkbox
- Timestamp formatted dynamically

#### Metadata Badges
**Elements:**
1. `<span id="targetBadge">` - Shows target type (e.g., "All Servers", "Specific Server")
2. `<span id="scheduleBadge">` - Shows schedule type (e.g., "Now", "Daily at 12:00 PM")

#### Action Buttons
1. **Update Preview**
   - Button: `<button onclick="updatePreview()">`
   - Icon: 🔄
   - Manually refreshes preview

2. **Send Test**
   - Button: `<button onclick="sendTestMessage()">`
   - Icon: 🧪
   - Sends test message to admin/test channel

---

### 3. Actions Section
**Purpose:** Execute message sending or scheduling

#### Send Message Button
**Button:** `<button onclick="sendMessage()">`
**Icon:** 📤
**Label:** "Send Message"
**Function:** Sends message immediately to selected target(s)

#### Schedule Message Button
**Button:** `<button onclick="scheduleMessage()">`
**Icon:** 🕒
**Label:** "Schedule"
**Function:** Schedules message based on schedule configuration

---

### 4. Sending Progress Section
**Purpose:** Real-time progress tracking during message delivery

**Container:** `<div id="sendingProgress">` (hidden by default)

#### Components:
1. **Progress Bar**
   ```html
   <div class="progress">
     <div id="progressFill" class="bar"></div>
   </div>
   ```
   - Animated width from 0% to 100%
   - Gradient: `linear-gradient(90deg, #6366f1, #10b981)`

2. **Progress Text**
   - Element: `<div id="progressText">`
   - Updates: "Preparing to send…" → "Sending to servers…" → "Complete!"

3. **Delivery Results**
   - Element: `<div id="deliveryResults">`
   - Shows detailed results after completion:
     - Total servers targeted
     - Successful deliveries
     - Failed deliveries
     - Error messages (if any)

---

### 5. Auto Setup Outreach Section
**Purpose:** Send guided auto-setup flow to servers

#### Server Selector
**Field:** `<select id="autoSetupServerSelect">`
**Default:** "Loading servers..."
**Purpose:** Select specific server for auto-setup message

#### Action Buttons
1. **Send Auto Setup Packet** - Single server
   - Button: `<button onclick="sendAutoSetupMessage()">`
   - Icon: 🚀
   - Targets selected server

2. **Send to All Servers** - Broadcast
   - Button: `<button onclick="sendAutoSetupMessage(true)">`
   - Icon: 🌐
   - Warning badge (warn color)
   - Sends to ALL servers

3. **Refresh List**
   - Button: `<button onclick="loadAutoSetupServers()">`
   - Icon: 🔄
   - Reloads server list

#### Status Display
**Element:** `<div id="autoSetupStatus">`
**Default:** "Send the guided Auto Setup flow to selected or all servers."
**Updates:** Shows success/error messages after sending

---

## JavaScript Functions

### 1. updateMessageTemplate()
**Purpose:** Fill title and content based on selected template

**Implementation:**
```javascript
function updateMessageTemplate() {
    const type = document.getElementById('messageType').value;
    const templates = {
        announcement: { title: '📢 Important Announcement', content: '...' },
        update: { title: '🔄 Bot Update', content: '...' },
        maintenance: { title: '🔧 Scheduled Maintenance', content: '...' },
        feature: { title: '✨ New Feature', content: '...' },
        warning: { title: '⚠️ Important Notice', content: '...' },
        celebration: { title: '🎉 Celebration', content: '...' }
    };
    if (templates[type]) {
        document.getElementById('messageTitle').value = templates[type].title;
        document.getElementById('messageContent').value = templates[type].content;
        updateCharCount();
        updatePreview();
    }
}
```

### 2. updateCharCount()
**Purpose:** Update character counter for content field

**Implementation:**
```javascript
function updateCharCount() {
    const content = document.getElementById('messageContent').value;
    document.getElementById('charCount').textContent = content.length;
}
```

**Event:** `oninput` on textarea

### 3. updateTargetOptions()
**Purpose:** Show/hide server selector based on target type

**Implementation:**
```javascript
function updateTargetOptions() {
    const targetType = document.getElementById('targetType').value;
    const serverGroup = document.getElementById('serverSelectGroup');
    
    if (targetType === 'specific') {
        serverGroup.style.display = 'block';
        loadServerList(); // Fetch and populate servers
    } else {
        serverGroup.style.display = 'none';
    }
    
    updatePreview();
}
```

### 4. updateScheduleOptions()
**Purpose:** Show/hide time picker and custom cron input

**Implementation:**
```javascript
function updateScheduleOptions() {
    const schedule = document.getElementById('schedule').value;
    const timeGroup = document.getElementById('timeSelectionGroup');
    const customGroup = document.getElementById('customScheduleGroup');
    
    if (schedule === 'custom') {
        customGroup.style.display = 'block';
        timeGroup.style.display = 'none';
    } else if (schedule === 'now') {
        customGroup.style.display = 'none';
        timeGroup.style.display = 'none';
    } else {
        customGroup.style.display = 'none';
        timeGroup.style.display = 'block';
    }
    
    updatePreview();
}
```

### 5. updatePreview()
**Purpose:** Update real-time preview of embed

**Implementation:**
```javascript
function updatePreview() {
    const title = document.getElementById('messageTitle').value || 'Title will appear here';
    const content = document.getElementById('messageContent').value || 'Message content will appear here';
    const color = document.getElementById('messageColor').value;
    const includeFooter = document.getElementById('includeFooter').checked;
    const targetType = document.getElementById('targetType').value;
    const schedule = document.getElementById('schedule').value;
    
    // Update preview content
    document.getElementById('previewTitle').textContent = title;
    document.getElementById('previewContent').textContent = content;
    
    // Update border color
    const embedPreview = document.querySelector('.embed-preview');
    embedPreview.style.borderLeftColor = color;
    
    // Update footer
    if (includeFooter) {
        document.getElementById('previewFooter').style.display = 'block';
        document.getElementById('previewFooter').textContent = 
            'AirTranslator Bot • ' + new Date().toLocaleTimeString();
    } else {
        document.getElementById('previewFooter').style.display = 'none';
    }
    
    // Update badges
    const targetLabels = {
        all: 'All Servers',
        specific: 'Specific Server',
        large: 'Large Servers',
        active: 'Active Servers'
    };
    document.getElementById('targetBadge').textContent = targetLabels[targetType] || 'Target';
    
    const scheduleLabels = {
        now: 'Now',
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        custom: 'Custom Schedule'
    };
    document.getElementById('scheduleBadge').textContent = scheduleLabels[schedule] || 'Schedule';
}
```

### 6. sendMessage()
**Purpose:** Send message immediately to target servers

**Implementation:**
```javascript
async function sendMessage() {
    const title = document.getElementById('messageTitle').value;
    const content = document.getElementById('messageContent').value;
    const color = document.getElementById('messageColor').value;
    const targetType = document.getElementById('targetType').value;
    const targetServer = document.getElementById('targetServer')?.value;
    const includeFooter = document.getElementById('includeFooter').checked;
    const urgentMessage = document.getElementById('urgentMessage').checked;
    
    if (!content.trim()) {
        alert('Please enter message content');
        return;
    }
    
    // Show progress section
    document.getElementById('sendingProgress').style.display = 'block';
    document.getElementById('progressText').textContent = 'Preparing to send...';
    
    try {
        const response = await fetch('/admin/messaging/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title, content, color, targetType, targetServer,
                includeFooter, urgentMessage
            })
        });
        
        const data = await response.json();
        
        // Update progress bar
        let progress = 0;
        const interval = setInterval(() => {
            progress += 10;
            document.getElementById('progressFill').style.width = progress + '%';
            
            if (progress >= 100) {
                clearInterval(interval);
                displayResults(data);
            }
        }, 100);
        
    } catch (error) {
        console.error('Error sending message:', error);
        document.getElementById('progressText').textContent = 'Error: ' + error.message;
    }
}
```

### 7. sendTestMessage()
**Purpose:** Send test message to a test channel

**Implementation:**
```javascript
async function sendTestMessage() {
    const title = document.getElementById('messageTitle').value;
    const content = document.getElementById('messageContent').value;
    const color = document.getElementById('messageColor').value;
    const includeFooter = document.getElementById('includeFooter').checked;
    
    if (!content.trim()) {
        alert('Please enter message content');
        return;
    }
    
    try {
        const response = await fetch('/admin/messaging/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, color, includeFooter })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (typeof showNotification === 'function') {
                showNotification('Test message sent successfully!', 'success');
            } else {
                alert('Test message sent successfully!');
            }
        } else {
            throw new Error(data.message || 'Failed to send test message');
        }
    } catch (error) {
        console.error('Error sending test message:', error);
        if (typeof showNotification === 'function') {
            showNotification('Error: ' + error.message, 'error');
        } else {
            alert('Error: ' + error.message);
        }
    }
}
```

### 8. scheduleMessage()
**Purpose:** Schedule message for later delivery

**Implementation:**
```javascript
async function scheduleMessage() {
    const title = document.getElementById('messageTitle').value;
    const content = document.getElementById('messageContent').value;
    const color = document.getElementById('messageColor').value;
    const targetType = document.getElementById('targetType').value;
    const targetServer = document.getElementById('targetServer')?.value;
    const schedule = document.getElementById('schedule').value;
    const scheduleTime = document.getElementById('scheduleTime')?.value;
    const customSchedule = document.getElementById('customSchedule')?.value;
    const timezone = document.getElementById('timezone').value;
    const includeFooter = document.getElementById('includeFooter').checked;
    const urgentMessage = document.getElementById('urgentMessage').checked;
    
    if (!content.trim()) {
        alert('Please enter message content');
        return;
    }
    
    if (schedule === 'custom' && !customSchedule) {
        alert('Please enter custom cron schedule');
        return;
    }
    
    try {
        const response = await fetch('/admin/messaging/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title, content, color, targetType, targetServer,
                schedule, scheduleTime, customSchedule, timezone,
                includeFooter, urgentMessage
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (typeof showNotification === 'function') {
                showNotification('Message scheduled successfully!', 'success');
            } else {
                alert('Message scheduled successfully!');
            }
        } else {
            throw new Error(data.message || 'Failed to schedule message');
        }
    } catch (error) {
        console.error('Error scheduling message:', error);
        if (typeof showNotification === 'function') {
            showNotification('Error: ' + error.message, 'error');
        } else {
            alert('Error: ' + error.message);
        }
    }
}
```

### 9. sendAutoSetupMessage(sendAll)
**Purpose:** Send auto-setup flow to selected server(s)

**Implementation:**
```javascript
async function sendAutoSetupMessage(sendAll = false) {
    const serverId = !sendAll ? document.getElementById('autoSetupServerSelect').value : null;
    
    if (!sendAll && !serverId) {
        alert('Please select a server');
        return;
    }
    
    const confirmed = sendAll ? 
        confirm('Are you sure you want to send Auto Setup to ALL servers?') : true;
    
    if (!confirmed) return;
    
    try {
        document.getElementById('autoSetupStatus').textContent = 'Sending...';
        
        const response = await fetch('/admin/messaging/auto-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverId, sendAll })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('autoSetupStatus').textContent = 
                `✅ ${data.message || 'Auto setup sent successfully!'}`;
        } else {
            throw new Error(data.message || 'Failed to send auto setup');
        }
    } catch (error) {
        console.error('Error sending auto setup:', error);
        document.getElementById('autoSetupStatus').textContent = '❌ Error: ' + error.message;
    }
}
```

### 10. loadAutoSetupServers()
**Purpose:** Populate server dropdown for auto-setup

**Implementation:**
```javascript
async function loadAutoSetupServers() {
    try {
        const response = await fetch('/admin/servers/list');
        const data = await response.json();
        
        const select = document.getElementById('autoSetupServerSelect');
        select.innerHTML = '<option value="">Select a server...</option>';
        
        if (data.servers) {
            data.servers.forEach(server => {
                const option = document.createElement('option');
                option.value = server.id;
                option.textContent = `${server.name} (${server.memberCount} members)`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading servers:', error);
        document.getElementById('autoSetupServerSelect').innerHTML = 
            '<option value="">Error loading servers</option>';
    }
}
```

### 11. displayResults(data)
**Purpose:** Show delivery results after sending

**Implementation:**
```javascript
function displayResults(data) {
    document.getElementById('progressText').textContent = 'Complete!';
    
    const resultsHtml = `
        <div style="margin-top:12px; padding:12px; background:#f9fafb; border-radius:8px;">
            <strong>Delivery Report:</strong><br>
            <span style="color:#10b981;">✅ Success: ${data.successCount || 0}</span><br>
            <span style="color:#ef4444;">❌ Failed: ${data.failCount || 0}</span><br>
            ${data.errors ? `<div style="margin-top:8px; font-size:12px; color:#64748b;">${data.errors.join('<br>')}</div>` : ''}
        </div>
    `;
    
    document.getElementById('deliveryResults').innerHTML = resultsHtml;
}
```

---

## API Endpoints

### POST /admin/messaging/send
**Purpose:** Send message immediately
**Body:** `{ title, content, color, targetType, targetServer, includeFooter, urgentMessage }`
**Response:** `{ success, successCount, failCount, errors }`

### POST /admin/messaging/test
**Purpose:** Send test message
**Body:** `{ title, content, color, includeFooter }`
**Response:** `{ success, message }`

### POST /admin/messaging/schedule
**Purpose:** Schedule message
**Body:** `{ title, content, color, targetType, targetServer, schedule, scheduleTime, customSchedule, timezone, includeFooter, urgentMessage }`
**Response:** `{ success, jobId, message }`

### POST /admin/messaging/auto-setup
**Purpose:** Send auto-setup flow
**Body:** `{ serverId, sendAll }`
**Response:** `{ success, message }`

### GET /admin/servers/list
**Purpose:** Get list of servers
**Response:** `{ servers: [{ id, name, memberCount }] }`

---

## Styling Requirements

### Colors
- Primary gradient: `linear-gradient(135deg, #6366f1, #8b5cf6)`
- Success: `#10b981`
- Warning: `#f59e0b`
- Danger: `#ef4444`

### Layout
- Two-column grid: compose (left, 1.3fr) + preview/actions (right, 0.9fr)
- Mobile: stacks to single column (<980px)

### Components
- Cards: white background, 1px border, 12px radius, shadow: `0 8px 20px rgba(0,0,0,.04)`
- Inputs: `#f9fafb` background, 1.5px border `#e5e7eb`, 10px radius, focus: `#6366f1` border
- Buttons: gradient background, white text, 10px radius, hover: brightness(1.04), active: translateY(1px)
- Progress bar: 10px height, rounded, gradient fill

---

##Styling (comprehensive):

**Complete Styling:**
```css
.messaging-container { color: #1f2937; }
.messaging-container .grid { display:grid; grid-template-columns: 1.3fr .9fr; gap:20px; }
.messaging-container .card { background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; box-shadow: 0 8px 20px rgba(0,0,0,.04); }
.messaging-container .card .card-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f3f4f6; }
.messaging-container .card .card-body { padding:16px; }
.messaging-container select, input[type="text"], textarea, input[type="time"] {
  width:100%; background:#f9fafb; border:1.5px solid #e5e7eb; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; transition:border-color .2s, box-shadow .2s; color:#111827;
}
.messaging-container select:focus, input:focus, textarea:focus {
  border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.18);
}
.messaging-container .controls .btn { appearance:none; border:0; border-radius:10px; padding:12px 16px; font-weight:700; cursor:pointer; transition:filter .15s, transform .04s; display:inline-flex; align-items:center; gap:8px; }
.messaging-container .controls .btn.primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }
.messaging-container .controls .btn:hover { filter:brightness(1.04); }
.messaging-container .controls .btn:active { transform: translateY(1px); }
.messaging-container .embed { border-left:5px solid #6366f1; background:#f9fafb; border-radius:10px; padding:14px; }
.messaging-container .progress { background:#f3f4f6; height:10px; border-radius:999px; overflow:hidden; }
.messaging-container .progress .bar { height:100%; width:0%; background:linear-gradient(90deg,#6366f1,#10b981); transition: width .3s ease; }
```

---

## Data Flow

### Message Creation Flow:
1. User selects template (optional)
2. Fills title, content, color
3. Selects target (all/specific/large/active)
4. Configures schedule (now/daily/weekly/monthly/custom)
5. Sets timezone and options
6. Previews in real-time
7. Sends or schedules

### Auto-Setup Flow:
1. Loads server list on init
2. User selects server or "all"
3. Sends auto-setup packet via API
4. Server receives channel selection UI
5. User selects channels
6. Bot configures translations automatically
