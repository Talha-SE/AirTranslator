# Admin Dashboard - Monetization Tab Feature Documentation

## Complete Feature Analysis from Original Admin Server

### 1. Data Sources & Database Connections

#### Services Used:
- **monetizationService**: Core monetization logic
  - `getSettings()` - Get global monetization settings
  - `getAllServersStatus(client)` - Get status of all servers
  - `getVoteStats()` - Get voting statistics
  - `updateGlobalSettings(settings)` - Update global settings
  - `addExemptServer(serverId, durationDays)` - Add server to exempt list
  - `removeExemptServer(serverId)` - Remove server from exempt list
  - `addRestrictedServer(serverId)` - Add server to restricted list
  - `removeRestrictedServer(serverId)` - Remove server from restricted list
  - `resetServerCount(serverId)` - Reset server translation count
  - `setCustomLimit(serverId, limit)` - Set custom translation limit
  - `checkServerStatus(serverId)` - Check individual server status

- **databaseService**: Database operations
  - `getPendingPremiumRequests(limit)` - Get pending premium requests
  - `approvePremiumRequest(requestId, approver, durationDays)` - Approve premium request
  - `rejectPremiumRequest(requestId, approver, reason)` - Reject premium request
  - `deleteVoteEventById(voteId)` - Delete specific vote record

#### Data Structures:

**Vote Stats Object:**
```javascript
{
    totalVoteClicks: Number,        // Total number of vote clicks
    totalCreditsGranted: Number,    // Total credits auto-granted
    todayVotes: Number,             // Votes today
    recentVotesCount: Number,       // Count of recent votes
    recentVotes: [                  // Array of recent vote objects
        {
            id: String,             // Vote record ID
            serverId: String,       // Discord server ID
            timestamp: Date,        // Vote timestamp
            creditsGranted: Number, // Credits given for this vote
            user: {
                id: String,         // Discord user ID
                username: String,   // Discord username
                displayName: String // Discord display name
            }
        }
    ]
}
```

**Server Status Object:**
```javascript
{
    id: String,                     // Server ID
    name: String,                   // Server name
    memberCount: Number,            // Number of members
    translationCount: Number,       // Current translation count
    freeTranslationLimit: Number,   // Translation limit
    isExempt: Boolean,              // Is server exempt
    exemptUntil: Date,              // Exemption expiry date
    isRestricted: Boolean,          // Is server restricted
    canTranslate: Boolean           // Can server translate
}
```

**Premium Request Object:**
```javascript
{
    _id: String,                    // MongoDB ObjectId
    serverId: String,               // Server ID
    serverName: String,             // Server name
    requesterUserId: String,        // User who requested
    requesterUsername: String,      // Username
    requesterDisplayName: String,   // Display name
    createdAt: Date,                // Request creation date
    status: String                  // Request status
}
```

**Global Settings Object:**
```javascript
{
    defaultFreeTranslationLimit: Number,  // Default limit for new servers
    enableGlobalRestriction: Boolean      // Apply restriction to all servers
}
```

---

### 2. UI Components & Sections

#### Section 1: Global Statistics (6 Cards)
- **Total Servers**: Count of all servers
- **Total Translations**: Sum of all translations across servers
- **Active Servers**: Servers that can translate or are exempt
- **Exempt Servers**: Count of exempt servers
- **Over Limit**: Servers over translation limit (not exempt)
- **Restricted Servers**: Count of restricted servers

**Calculation Logic:**
```javascript
totalServers = serversStatus.length
totalTranslations = serversStatus.reduce((sum, s) => sum + s.translationCount, 0)
exemptServers = serversStatus.filter(s => s.isExempt).length
restrictedServers = serversStatus.filter(s => s.isRestricted).length
overLimitServers = serversStatus.filter(s => !s.canTranslate && !s.isExempt).length
activeServers = serversStatus.filter(s => s.canTranslate || s.isExempt).length
```

#### Section 2: Vote Tracking & Auto-Credits

**4 Stat Cards:**
1. Total Vote Clicks - `voteStats.totalVoteClicks`
2. Credits Auto-Granted - `voteStats.totalCreditsGranted`
3. Today's Votes - `voteStats.todayVotes`
4. Recent Activity - `voteStats.recentVotesCount`

**Recent Vote Activity Table:**
- **Columns**: Server ID, User, Credits Granted, Timestamp, Status, Actions
- **Features**:
  - Shows last 20 votes
  - User enrichment from Discord API (fetch username/displayName)
  - Filters: Status (all/granted/blocked), Server ID (text search)
  - Auto-refresh every 30 seconds
  - Delete vote record action
  - Copy user ID button
  - Open Discord profile button

**User Enrichment Logic:**
```javascript
// Fetch user data from Discord API if username is missing or numeric
if (!currentName || /^\d+$/.test(currentName)) {
    const cached = client.users.cache.get(uid)
    if (cached) use cached.username
    else fetch from API: await client.users.fetch(uid)
}
```

**Filter Implementation:**
- Status filter: 'all', 'granted' (creditsGranted > 0), 'blocked' (creditsGranted <= 0)
- Server ID filter: String contains match on serverId
- Debounced server filter (400ms delay)
- Clear filters button resets both to defaults

**Delete Vote Record:**
- Endpoint: POST `/admin/monetization/vote/delete`
- Body: `{ voteId: String }`
- Confirmation required
- Refreshes table after deletion

#### Section 3: Premium Requests

**Table Columns:**
- Request ID (MongoDB _id)
- Server (serverName)
- Server ID
- Requester (displayName/username + userId)
- Created (timestamp)
- Actions (Approve/Reject with duration input)

**Features:**
- Shows all pending premium requests
- Duplicate detection (shows badge if multiple requests for same server)
- Duration input (days, default 30, range 1-3650)
- Approve button - grants exemption for specified days
- Reject button - prompts for optional rejection reason

**Duplicate Detection:**
```javascript
const duplicateCounts = pendingPremium.reduce((acc, pr) => {
    const sid = pr.serverId || 'unknown'
    acc[sid] = (acc[sid] || 0) + 1
    return acc
}, {})
// Show "Dup" badge if duplicateCounts[serverId] > 1
```

**Approve Premium:**
- Endpoint: POST `/admin/monetization/premium/approve`
- Body: `{ requestId: String, durationDays: Number }`
- Actions:
  1. Call `databaseService.approvePremiumRequest(requestId, admin, days)`
  2. Call `monetizationService.addExemptServer(serverId, days)`
  3. Send DM to requester with approval details
  4. Send message to server's system/general channel
  5. Reload page to update pending list

**Notification Embeds:**
```javascript
// DM to user
EmbedBuilder()
    .setColor('#6C8BFF')
    .setTitle('💎 Premium Enabled')
    .setDescription(approval message with duration and expiry)
    .setTimestamp()
    .setFooter({ text: 'Air Translator • Confirmation' })

// Message to server channel
Same embed sent to systemChannel or first available channel with permissions
```

**Reject Premium:**
- Endpoint: POST `/admin/monetization/premium/reject`
- Body: `{ requestId: String, reason: String|null }`
- Actions:
  1. Call `databaseService.rejectPremiumRequest(requestId, admin, reason)`
  2. Send DM to requester with rejection reason
  3. Include subscription URL and support server link
  4. Send message to server's channel
  5. Reload page

**Rejection Notification:**
```javascript
// Includes:
- Rejection message
- Optional reason from admin
- Official Price Page URL: https://airtranslator.brevios.com/pricing
- Support server: https://discord.gg/WeynxzR9nq
```

#### Section 4: Global Settings

**Settings:**
1. **Default Free Translation Limit**
   - Input: Number (min: 1, max: 1000)
   - Default value from `settings.defaultFreeTranslationLimit`
   - Applied to new servers joining

2. **Enable Global Restriction**
   - Input: Checkbox
   - Default value from `settings.enableGlobalRestriction`
   - When enabled: all servers restricted unless specifically exempted

**Save Action:**
- Endpoint: POST `/admin/monetization/settings`
- Body: `{ defaultFreeTranslationLimit: Number, enableGlobalRestriction: Boolean }`
- Updates global settings via `monetizationService.updateGlobalSettings()`

#### Section 5: Quick Actions

**Single Server Actions:**
- Server ID input field
- 4 Action buttons

**1. Add to Exempt List**
- Endpoint: POST `/admin/monetization/exempt/add`
- Body: `{ serverId: String, durationDays: Number|null }`
- Prompts for duration (default 30 days, blank = unlimited)
- Calls `monetizationService.addExemptServer(serverId, days)`

**2. Add to Restricted List**
- Endpoint: POST `/admin/monetization/restrict/add`
- Body: `{ serverId: String }`
- Calls `monetizationService.addRestrictedServer(serverId)`

**3. Reset Translation Count**
- Endpoint: POST `/admin/monetization/reset-count`
- Body: `{ serverId: String }`
- Resets translation counter to 0
- Calls `monetizationService.resetServerCount(serverId)`
- Confirmation required

**4. Set Custom Limit**
- Custom limit input field (min: 1, max: 10000)
- Endpoint: POST `/admin/monetization/custom-limit`
- Body: `{ serverId: String, customLimit: Number }`
- Calls `monetizationService.setCustomLimit(serverId, limit)`

#### Section 6: Bulk Server Actions

**3 Bulk Operations:**

**1. Restrict All Servers**
- Endpoint: POST `/admin/monetization/bulk/restrict-all`
- Logic:
  ```javascript
  for (const guild of client.guilds.cache.values()) {
      const status = await monetizationService.checkServerStatus(guild.id)
      if (!status.isExempt) {
          await monetizationService.addRestrictedServer(guild.id)
      }
  }
  ```
- Skips exempt servers
- Returns affected count
- Confirmation required: "Apply restrictions to ALL servers?"

**2. Remove All Restrictions**
- Endpoint: POST `/admin/monetization/bulk/remove-restrictions`
- Logic:
  ```javascript
  for (const guild of client.guilds.cache.values()) {
      const status = await monetizationService.checkServerStatus(guild.id)
      if (status.isRestricted && !status.isExempt) {
          await monetizationService.removeRestrictedServer(guild.id)
      }
  }
  ```
- Skips exempt servers
- Returns affected count
- Confirmation required

**3. Reset All Counts**
- Endpoint: POST `/admin/monetization/bulk/reset-counts`
- Logic:
  ```javascript
  for (const guild of client.guilds.cache.values()) {
      await monetizationService.resetServerCount(guild.id)
  }
  ```
- Resets all server translation counters
- Returns affected count
- Confirmation required: "Reset translation counts for ALL servers?"

#### Section 7: Server Management Table

**Search & Filter:**
- Search input: Filters by server name, ID, or any text in row
- 4 Filter buttons:
  - All Servers
  - Restricted
  - Exempt
  - Over Limit

**Table Columns:**
1. **Server Name** - guild.name
2. **Server ID** - guild.id (code format)
3. **Members** - serverStatus.memberCount
4. **Translations** - `count/limit` format, red if over limit
5. **Status** - Badge showing current status
6. **Exemption** - Shows exemption details if applicable
7. **Actions** - Context-specific buttons

**Status Badge Logic:**
```javascript
function getServerStatusClass(server) {
    // Check expired exemption first
    if (server.isExempt && server.exemptUntil) {
        if (new Date(server.exemptUntil) < Date.now()) {
            return 'restricted' // Expired
        }
    }
    if (server.isExempt) return 'exempt'
    if (!server.canTranslate) return 'over-limit'
    if (server.isRestricted) return 'restricted'
    return 'active'
}
```

**Status Text:**
- Active - Can translate normally
- Exempt - Premium/exempt from limits
- Restricted - Manually restricted
- Over Limit - Hit translation limit
- Expired (Restricted) - Exemption expired

**Exemption Display:**
```javascript
if (server.isExempt) {
    if (server.exemptUntil) {
        const daysLeft = Math.ceil((exemptUntil - now) / (24*60*60*1000))
        if (daysLeft > 0) {
            show: "Until DATE (Xd left)"
        } else {
            show: "Expired"
        }
    } else {
        show: "Unlimited"
    }
}
```

**Server Actions (Dynamic):**
- If exempt (not expired): **Remove Exempt** button
- If not exempt: **Add Exempt** button
- If translation count > 0: **Reset Count** button

**Action Endpoints:**
- Remove: POST `/admin/monetization/exempt/remove` - `{ serverId }`
- Add: Prompts for duration, POST `/admin/monetization/exempt/add`
- Reset: POST `/admin/monetization/reset-count` - `{ serverId }`

---

### 3. JavaScript Functions Required

#### Core Functions:
1. `saveGlobalSettings()` - Save settings
2. `addExemptServer(serverId?)` - Add exempt
3. `removeExemptServer(serverId)` - Remove exempt
4. `addRestrictedServer(serverId?)` - Add restricted
5. `resetServerCount(serverId?)` - Reset count
6. `setCustomLimit()` - Set custom limit
7. `approvePremium(requestId, serverId)` - Approve request
8. `rejectPremium(requestId, serverId)` - Reject request
9. `deleteVoteRecord(voteId)` - Delete vote
10. `refreshRecentVotes(silent)` - Refresh vote table
11. `handleVoteServerFilter()` - Debounced filter
12. `clearVoteFilters()` - Clear filters
13. `bulkRestrictAll()` - Bulk restrict
14. `bulkRemoveRestrictions()` - Bulk remove
15. `bulkResetCounts()` - Bulk reset
16. `searchMonetizationServers()` - Search servers
17. `filterServers(status)` - Filter by status
18. `copyToClipboard(text)` - Copy utility

#### Helper Functions:
- Auto-refresh votes every 30s: `setInterval(() => refreshRecentVotes(true), 30000)`
- Debounce for server filter: `debounce(fn, 400ms)`
- Notification display: `showNotification(message, type)`

---

### 4. API Endpoints Summary

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/admin/monetization/settings` | `{defaultFreeTranslationLimit, enableGlobalRestriction}` | `{success}` |
| POST | `/admin/monetization/exempt/add` | `{serverId, durationDays}` | `{success}` |
| POST | `/admin/monetization/exempt/remove` | `{serverId}` | `{success}` |
| POST | `/admin/monetization/restrict/add` | `{serverId}` | `{success}` |
| POST | `/admin/monetization/restrict/remove` | `{serverId}` | `{success}` |
| POST | `/admin/monetization/reset-count` | `{serverId}` | `{success}` |
| POST | `/admin/monetization/custom-limit` | `{serverId, customLimit}` | `{success}` |
| POST | `/admin/monetization/premium/approve` | `{requestId, durationDays}` | `{success, serverId, serverName, expiresAt}` |
| POST | `/admin/monetization/premium/reject` | `{requestId, reason}` | `{success, serverId, serverName}` |
| POST | `/admin/monetization/vote/delete` | `{voteId}` | `{success}` |
| GET | `/admin/monetization/recent-votes?status=&serverId=` | - | `{success, tbody, count}` |
| POST | `/admin/monetization/bulk/restrict-all` | - | `{success, affectedCount}` |
| POST | `/admin/monetization/bulk/remove-restrictions` | - | `{success, affectedCount}` |
| POST | `/admin/monetization/bulk/reset-counts` | - | `{success, affectedCount}` |

---

### 5. Styling Requirements

**Badge Colors:**
- `.badge-active` - Green (#ecfdf5 bg, #065f46 text)
- `.badge-restricted` - Red (#fef2f2 bg, #991b1b text)
- `.badge-exempt` - Blue (#eff6ff bg, #1e40af text)
- `.badge-over-limit` - Orange (#fff7ed bg, #9a3412 text)
- `.badge-success` - Green success badge
- `.badge-warning` - Yellow warning badge

**Stats Grid:**
- `.stats-grid` - 4 columns, responsive
- `.stats-grid-6` - 6 columns for global stats
- `.stat-box` - Stat card with icon, value, label
- Hover effect: lift and shadow

**Tables:**
- `.data-table` - Standard table styling
- Sticky header on scroll
- Row hover effect
- Responsive scroll container

**Buttons:**
- `.btn-success` - Green submit/approve
- `.btn-danger` - Red delete/reject  
- `.btn-warning` - Orange warning actions
- `.btn-info` - Blue info actions
- `.btn-outline` - Outlined variant
- `.btn-sm` - Small size
- `.btn-xs` - Extra small size

**Filter Buttons:**
- `.filter-btn` - Pill-shaped filter
- `.filter-btn.active` - Active filter (primary color)

---

### 6. Critical Implementation Notes

1. **User Enrichment**: Must handle numeric usernames by fetching from Discord API
2. **Exemption Expiry**: Check `exemptUntil < Date.now()` to detect expired exemptions
3. **Duplicate Requests**: Count requests per serverId and show warning badge
4. **Confirmation Dialogs**: All destructive actions need confirm()
5. **Auto-Refresh**: Vote table refreshes every 30s silently
6. **Error Handling**: All API calls wrapped in try-catch with user notifications
7. **Loading States**: Buttons disabled during operations
8. **Page Reload**: After approve/reject premium, reload to update pending list
9. **Discord Notifications**: Premium approve/reject sends embeds to user DM and server channel
10. **Channel Selection**: For server messages, find systemChannel or general/chat/announce channels with permissions

---

### 7. State Management

**Global Client Reference:**
```javascript
global.discordClient = client
// Used in handlers to access:
// - client.guilds.cache
// - client.users.cache.get(id)
// - client.users.fetch(id)
// - client.channels.cache
```

**Session Management:**
- Sessions stored in Map with TTL
- getSession(sessionToken) returns session object
- Session includes username for audit trails

---

### 8. Data Flow

**Vote Record Deletion:**
1. User clicks Delete on vote row
2. Confirm dialog
3. POST to `/admin/monetization/vote/delete`
4. Handler calls `databaseService.deleteVoteEventById(voteId)`
5. Return success
6. Frontend calls `refreshRecentVotes(true)`
7. GET `/admin/monetization/recent-votes` with filters
8. Handler fetches votes from `monetizationService.getVoteStats()`
9. Enriches user data from Discord API
10. Applies status & server filters
11. Generates tbody HTML
12. Returns `{tbody, count}`
13. Frontend updates DOM

**Premium Approval:**
1. User enters duration, clicks Approve
2. POST to `/admin/monetization/premium/approve`
3. Handler gets request from `databaseService.approvePremiumRequest()`
4. Calls `monetizationService.addExemptServer(serverId, days)`
5. Fetches Discord user via `client.users.fetch()`
6. Sends DM with approval embed
7. Fetches guild, finds suitable channel
8. Sends server announcement embed
9. Returns success with details
10. Frontend reloads page

**Bulk Restrict All:**
1. User clicks button with confirmation
2. POST to `/admin/monetization/bulk/restrict-all`
3. Handler iterates `client.guilds.cache.values()`
4. For each guild:
   - Check status via `monetizationService.checkServerStatus()`
   - If not exempt, call `monetizationService.addRestrictedServer()`
   - Increment affectedCount
5. Returns `{success, affectedCount}`
6. Frontend shows notification with count
7. Reloads page after 1.5s

---

## Summary

The monetization tab is a comprehensive admin interface managing:
- Server translation limits and exemptions
- Premium request approvals/rejections
- Vote tracking with auto-credit system
- Global monetization settings
- Individual and bulk server actions
- Real-time server status monitoring

All actions are logged, require confirmation for destructive operations, and provide user feedback via Discord DMs and server announcements where applicable.
