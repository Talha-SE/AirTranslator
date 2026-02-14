# Server Management Tab - Complete Feature Documentation

## Overview
The Server Management tab provides a comprehensive interface for viewing, managing, and interacting with all Discord servers where the bot is present. Features include grid/list views, search, sorting, member viewing, and server management actions.

---

## UI Sections

### 1. Header Section
**Purpose:** Display title, admin badge, and view toggle

**Components:**
1. **Title with Icon**
   - Text: "🏠 Server Management"
   - Font: 24px, extra-bold

2. **Admin Badge**
   - Icon: 🔒
   - Text: "Admin Panel"
   - Style: Gradient background `linear-gradient(135deg, #6366f1, #8b5cf6)`, white text, rounded pill

3. **View Toggle**
   - Two buttons: Grid (⊞) and List (☰)
   - Active button highlighted
   - Saves preference to localStorage
   - Function: `toggleServerView(event, 'grid'|'list')`

---

### 2. Statistics Cards (3 cards)
**Purpose:** Display key metrics about servers and members

**Cards:**
1. **Total Servers**
   - Icon: 🏢
   - Value: Total count of servers
   - Label: "Total Servers"

2. **Total Members**
   - Icon: 👥
   - Value: Sum of all members across all servers (localized)
   - Label: "Total Members"

3. **Avg Members/Server**
   - Icon: 📊
   - Value: Average member count per server
   - Label: "Avg Members/Server"

**Styling:**
- Grid layout: `repeat(auto-fit, minmax(220px, 1fr))`
- Gradient background: `linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05))`
- Hover effect: `translateY(-2px)` with enhanced shadow
- Large icon (36px) + value (28px bold) + label

---

### 3. Search and Sort Bar
**Purpose:** Filter and organize server list

#### Search Input
**Field:** `<input id="serverSearchInput" type="text">`
**Attributes:**
- Placeholder: "🔍 Search servers by name or ID..."
- Function: `onkeyup="filterServerCards()"`
- Real-time filtering by name or ID

#### Sort Selector
**Field:** `<select id="serverSortSelect">`
**Options:**
- members-desc - Members (High to Low)
- members-asc - Members (Low to High)
- name-asc - Name (A-Z)
- name-desc - Name (Z-A)
- joined-desc - Recently Joined
- joined-asc - Oldest First

**Function:** `onchange="sortServerCards()"`
**Storage:** Saves selection to localStorage

---

### 4. Server Cards Grid
**Purpose:** Display all servers in grid or list view

#### Grid View (Default)
**Layout:** `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))`
**Gap:** 16px

#### List View
**Layout:** `grid-template-columns: 1fr`
**Gap:** 12px
**Card Direction:** Horizontal (row layout)

#### Server Card Structure

**Data Attributes:**
- `data-server-id` - Server ID
- `data-server-name` - Lowercase server name (for filtering)
- `data-member-count` - Member count (for sorting)
- `data-joined` - Join timestamp (for sorting)

**Card Components:**

1. **Server Header**
   - Server icon (if available) or gradient placeholder with first letter
   - Server name (bold, 16px)
   - Server ID (monospace, 11px, grey)

2. **Server Stats**
   - Member count with label
   - Joined date with label
   - Background: `#f9fafb`
   - Two-column layout

3. **Joined Date Badge**
   - Full date formatted: "Joined: {month day, year}"
   - Background: `#f3f4f6`
   - Hidden in list view on mobile

4. **Action Buttons**
   - **Copy ID Button**
     - Icon: 📋
     - Text: "Copy ID"
     - Function: `copyServerId(serverId)`
     - Style: Info gradient (`#6366f1` to `#8b5cf6`)
   
   - **Leave Server Button**
     - Icon: 🚪
     - Text: "Leave Server"
     - Function: `leaveServer(serverId, serverName)`
     - Style: Danger gradient (`#ef4444` to `#dc2626`)
     - Requires confirmation

**Interactions:**
- Entire card clickable: `onclick="viewServerMembers(serverId, serverName)"`
- Hover effect: `translateY(-4px)` with purple border and enhanced shadow
- Button clicks stop event propagation

---

### 5. Empty State
**Purpose:** Display when no servers are found

**Components:**
- Icon: 🏜️ (64px)
- Title: "No Servers Found"
- Description: "The bot hasn't joined any servers yet."

---

## JavaScript Functions

### 1. filterServerCards()
**Purpose:** Filter cards by search query (name or ID)

**Implementation:**
```javascript
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
```

**Features:**
- Case-insensitive search
- Searches both server name and ID
- Real-time filtering (onkeyup event)

---

### 2. sortServerCards()
**Purpose:** Sort server cards by selected criteria

**Implementation:**
```javascript
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
```

**Features:**
- Sorts by member count (ascending/descending)
- Sorts alphabetically by name (A-Z/Z-A)
- Sorts by join date (recent/oldest first)
- Persists selection to localStorage
- Reorders DOM elements

---

### 3. toggleServerView(evt, viewType)
**Purpose:** Switch between grid and list views

**Implementation:**
```javascript
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
```

**Features:**
- Toggles CSS class on grid container
- Updates active button styling
- Saves preference to localStorage
- Restored on page load

---

### 4. copyServerId(serverId)
**Purpose:** Copy server ID to clipboard

**Implementation:**
```javascript
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
```

**Features:**
- Uses modern Clipboard API
- Fallback to execCommand for older browsers
- Shows success notification
- Stops event propagation

---

### 5. viewServerMembers(serverId, serverName)
**Purpose:** Fetch and display server members in modal

**Implementation:**
```javascript
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
```

**API:** GET `/admin/servers/:serverId/members`
**Response:** `{ success: boolean, members: Array<Member> }`

---

### 6. showMemberModal(serverName, serverId, members)
**Purpose:** Display members in a beautiful modal

**Implementation:**
Creates dynamic modal with:
- Gradient header (`linear-gradient(135deg, #667eea 0%, #764ba2 100%)`)
- Server name and ID
- Member count
- Search box for filtering members
- Member cards grid with:
  - Avatar placeholder (gradient circle with first letter)
  - Display name and username
  - User ID (monospace)
  - Bot badge (if bot)
  - Join date (if available)
- Close button (X)
- Backdrop (click to close)

**Member Card Structure:**
```html
<div class="member-card" data-username="..." data-displayname="..." data-id="...">
  <div style="avatar placeholder with gradient">Letter</div>
  <div>
    <div>Display Name</div>
    <div>@username</div>
    <div>ID: 123456789</div>
  </div>
  <div>
    <span>🤖 BOT</span>
    <span>Joined: date</span>
  </div>
</div>
```

**Features:**
- Colorful gradient avatars (5 color schemes rotating)
- Search/filter members by name, display name, or ID
- Scrollable list (max-height: 85vh)
- Responsive design
- Escape key to close
- Click backdrop to close

---

### 7. filterModalMembers()
**Purpose:** Filter members in modal by search query

**Implementation:**
```javascript
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
```

**Features:**
- Real-time filtering
- Case-insensitive
- Searches username, display name, and ID

---

### 8. closeMemberModal()
**Purpose:** Close and remove member modal

**Implementation:**
```javascript
function closeMemberModal() {
    const modal = document.getElementById('memberModal');
    if (modal) {
        modal.remove();
    }
}
```

**Event Listeners:**
- ESC key closes modal
- Click on backdrop closes modal

---

### 9. leaveServer(serverId, serverName)
**Purpose:** Leave a specific server with confirmation

**Implementation:**
```javascript
async function leaveServer(serverId, serverName) {
    const confirmed = confirm(
        'WARNING: Are you sure you want to leave "' + serverName + '"?\n\n' +
        'Server ID: ' + serverId + '\n\n' +
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
            
            // Remove the card from the UI with animation
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
```

**API:** POST `/admin/servers/leave`
**Body:** `{ serverId: string }`
**Response:** `{ success: boolean, message?: string }`

**Features:**
- Confirmation dialog with all details
- Stops event propagation
- Success notification
- Animated card removal (fade out + scale down)
- Reloads page after 1s to update stats

---

### 10. DOMContentLoaded Event Handler
**Purpose:** Restore saved preferences on page load

**Implementation:**
```javascript
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
```

**Features:**
- Restores grid/list view preference
- Restores sort option
- Re-applies sort on load

---

## API Endpoints

### GET /admin/servers/:serverId/members
**Purpose:** Fetch members of a specific server
**Parameters:** `serverId` (route param)
**Response:**
```json
{
  "success": true,
  "members": [
    {
      "id": "123456789",
      "username": "john_doe",
      "displayName": "John Doe",
      "isBot": false,
      "joinedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### POST /admin/servers/leave
**Purpose:** Leave a specific server
**Body:** `{ serverId: string }`
**Response:**
```json
{
  "success": true,
  "message": "Successfully left server"
}
```

---

## Data Structure

### Server Object
```javascript
{
    id: string,              // Discord server ID
    name: string,            // Server name
    memberCount: number,     // Total members
    joinedAt: Date,          // When bot joined
    icon: string | null,     // Server icon URL (64px)
    owner: string            // Owner user ID
}
```

### Member Object
```javascript
{
    id: string,              // Discord user ID
    username: string,        // Username
    displayName: string,     // Display name / nickname
    isBot: boolean,          // Is bot account
    joinedAt: Date | null    // When member joined server
}
```

---

## Styling Architecture

### Color Variables
```css
--primary-gradient: linear-gradient(135deg, #6366f1, #8b5cf6)
--danger-gradient: linear-gradient(135deg, #ef4444, #dc2626)
--bg-soft: rgba(99, 102, 241, 0.05)
--text: #111827
--muted: #6b7280
--border: #e5e7eb
```

### Layout Components
- **Stats Grid:** `repeat(auto-fit, minmax(220px, 1fr))`
- **Servers Grid:** `repeat(auto-fill, minmax(320px, 1fr))`
- **List View:** Single column (1fr)
- Gap: 16px (grid), 12px (list)

### Card Styling
```css
background: white
border: 1px solid #e5e7eb
border-radius: 16px
padding: 20px
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04)
transition: all 0.2s ease
```

**Hover Effects:**
- `transform: translateY(-4px)`
- `box-shadow: 0 12px 32px rgba(102, 126, 234, 0.15)`
- `border-color: #8b5cf6`

### Button Styling
```css
.sm-btn {
  flex: 1
  padding: 10px 14px
  border: none
  border-radius: 10px
  font-weight: 700
  font-size: 13px
  cursor: pointer
  transition: all 0.15s ease
  display: flex
  align-items: center
  justify-content: center
  gap: 6px
}

.sm-btn:hover {
  transform: translateY(-1px)
  filter: brightness(1.05)
}

.sm-btn-leave {
  background: linear-gradient(135deg, #ef4444, #dc2626)
  color: white
}

.sm-btn-info {
  background: linear-gradient(135deg, #6366f1, #8b5cf6)
  color: white
}
```

### Responsive Design

**Mobile (<768px):**
- Grid becomes single column
- Header stacks vertically
- View toggle spans full width
- List view cards stack vertically
- Stats section remains visible

---

## Local Storage Keys

### serverViewType
**Values:** `'grid'` | `'list'`
**Purpose:** Remember user's preferred view mode

### serverSortOption
**Values:** `'members-desc'` | `'members-asc'` | `'name-asc'` | `'name-desc'` | `'joined-desc'` | `'joined-asc'`
**Purpose:** Remember user's preferred sort order

---

## Member Modal Features

### Header
- Gradient background: `#667eea` to `#764ba2`
- White text
- Server name (24px bold)
- Server ID and member count
- Close button (white, rounded, hover effect)

### Search Box
- Integrated in header
- White background (95% opacity)
- Placeholder: "🔍 Search members by name, display name, or ID..."
- Real-time filtering

### Member List
- Scrollable container (max-height: 85vh)
- Grid of member cards with:
  - Avatar placeholder (48px, gradient background, white letter)
  - Display name (15px, bold)
  - Username with @ prefix (13px, grey)
  - User ID (12px, monospace, light grey)
  - Bot badge (if applicable): "🤖 BOT" (blue background)
  - Join date (if available): "Joined: {date}" (12px, grey)

### Avatar Color Schemes (5 rotating)
1. `#667eea` to `#764ba2` (purple)
2. `#f093fb` to `#f5576c` (pink)
3. `#4facfe` to `#00f2fe` (cyan)
4. `#43e97b` to `#38f9d7` (green)
5. `#fa709a` to `#fee140` (orange/yellow)

**Rotation:** `gradients[index % 5]`

### Empty State (No Members)
- Icon: 👥 (48px)
- Title: "No Members Found"
- Description: "Unable to fetch members for this server."

---

## Performance Considerations

### Server List Optimization
- Fetch once on page load
- Cache in DOM with data attributes
- Client-side filtering and sorting (no re-fetch)
- Minimal re-renders

### Member Modal
- Lazy load (fetch only when modal opened)
- Virtual scrolling not implemented (manageable with typical server sizes)
- Consider implementing for very large servers (1000+ members)

### Animations
- Hardware-accelerated transforms (translateY, scale)
- CSS transitions (no JavaScript animations)
- Smooth 0.2s to 0.3s durations

---

## Error Handling

### Network Errors
- Try-catch blocks for all API calls
- User-friendly error messages
- Fallback to alert() if notification system unavailable

### Missing Data
- Graceful fallbacks:
  - Unknown server name → "Unknown Server"
  - Missing icon → Gradient placeholder with first letter
  - Failed member fetch → Empty state with message

### Edge Cases
- Bot not in any servers → Empty state
- Server removed externally → Handled on next refresh
- No permissions → API error message displayed

---

## Future Enhancements
- Bulk server actions (leave multiple at once)
- Server categories/tags
- Export server list (CSV/JSON)
- Server activity heatmap
- Advanced filtering (by member count range, join date range)
- Server invite links
- Bot permissions viewer per server
- Edit server settings (prefix, language, etc.)
