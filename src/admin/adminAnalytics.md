# Analytics Tab - Complete Feature Documentation

## Overview
The Analytics tab provides comprehensive statistics, charts, and insights about bot performance, server activity, language usage, and system metrics.

---

## UI Sections

### 1. KPI Cards Grid (6 cards)
**Purpose:** Display key performance indicators at a glance

**Cards:**
1. **Active Servers**
   - Total server count
   - Total channels count
   - Badge: "Live"

2. **Total Reach**
   - Total members across all servers
   - Average members per server
   - Badge: "↑" (success)

3. **Total Translations**
   - Total translation count
   - Daily average translations
   - Peak day translations
   - Badge: "24h" (accent)

4. **System Uptime**
   - Hours, minutes, seconds
   - Memory usage (heap MB)
   - Badge: "OK" (warn)

5. **Active Channels**
   - Count of channels with translation activity
   - Coverage percentage (active/total)
   - Badge: "Net" (info)

6. **Language Pairs**
   - Total unique language pairs used
   - Top language pair name
   - Badge: "Mix" (neutral)

**Styling:**
- Grid layout: `repeat(auto-fit, minmax(240px, 1fr))`
- Cards with icon (emoji in colored background)
- Hover effect: translateY(-2px) with enhanced shadow
- Each card shows label, value, and subtitle

---

### 2. Translations Trend Chart
**Purpose:** Visualize translation activity over the last 14 days

**Implementation:**
- Uses Chart.js library
- Type: Line chart with area fill
- Data: `analytics.dailyStats` (last 14 days sorted descending)
- X-axis: Dates (formatted with `toLocaleDateString()`)
- Y-axis: Translation counts
- Styling:
  - Line color: `#667eea`
  - Fill: `rgba(102,126,234,0.12)`
  - Tension: 0.35 (curved line)
  - Point radius: 3, hover: 5
- Canvas height: 280px
- Responsive and maintains aspect ratio

**Data Processing:**
```javascript
const recentDays = Object.entries(analytics.dailyStats || {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14);
const chartLabels = recentDays.map(([date]) => new Date(date).toLocaleDateString());
const chartData = recentDays.map(([_, stats]) => (stats.translations || 0));
```

---

### 3. Top Servers Table
**Purpose:** Display top 10 servers by member count

**Columns:**
1. Server - Server name (bold)
2. Members - Member count (localized)
3. Joined - Join date (formatted)

**Data Source:**
```javascript
const topServers = (analytics.serverList || [])
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 10);
```

**Styling:**
- Compact table with minimal border
- Hover effect on rows (shadow + translateY)
- Pill badge for joined date

---

### 4. Language Usage Table
**Purpose:** Show top 10 language pairs with usage statistics

**Columns:**
1. Language Pair - e.g., "en-es"
2. Count - Translation count (localized)
3. % - Percentage with progress meter

**Data Processing:**
```javascript
const topLanguages = Object.entries(analytics.languageUsage || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
const percentage = analytics.totalTranslations > 0 ? 
    Math.round((count / analytics.totalTranslations) * 100) : 0;
```

**Features:**
- Percentage badge
- Horizontal progress meter (width based on %)
- Gradient fill: `linear-gradient(90deg, #667eea, #764ba2)`

---

### 5. Command Performance Table
**Purpose:** Display top 10 most-used commands with statistics

**Columns:**
1. Command - Command name with "/" prefix
2. Count - Usage count (localized)
3. % - Percentage with green progress meter

**Data Processing:**
```javascript
const topCommands = Object.entries(analytics.commandUsage || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
const totalCommands = Object.values(analytics.commandUsage || {}).reduce((sum, c) => sum + c, 0);
const percentage = totalCommands > 0 ? Math.round((count / totalCommands) * 100) : 0;
```

**Features:**
- Green success badge for percentage
- Green meter: `linear-gradient(90deg, #10b981, #34d399)`

---

### 6. Channel Activity Table
**Purpose:** Show top 10 most active translation channels

**Columns:**
1. Channel - Channel name (e.g., "#general")
2. Translations - Translation count
3. Activity - Percentage with blue meter
4. Server - Server name

**Data Processing:**
```javascript
const channelStats = Object.entries(analytics.channelActivity || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
const maxActivity = Math.max(...Object.values(analytics.channelActivity || {}));
const percentage = maxActivity > 0 ? Math.round((count / maxActivity) * 100) : 0;
```

**Features:**
- Fetches channel and server names from Discord client
- Fallback to "ID: {channelId}" if channel not found
- Blue meter: `linear-gradient(90deg, #3b82f6, #60a5fa)`
- Info badge for percentage

---

### 7. System Information Card
**Purpose:** Display technical system details

**Metrics:**
- Memory Usage - `heapUsed / heapTotal` in MB
- Bot Started - `analytics.botStartTime` formatted
- Node.js Version - `process.version`
- Platform - `process.platform` + `process.arch`
- Environment - `process.env.NODE_ENV || 'development'`

**Styling:**
- Key-value list with dashed borders
- Bold values
- Grey labels

---

### 8. Performance Metrics Card
**Purpose:** Show application performance statistics

**Metrics:**
- Total API Calls - Total translations count
- Success Rate - "99.8%" with green dot indicator
- Avg Response - "~1.2s" (static/estimated)
- Peak Daily - Peak day translation count
- Retention - "30 days rolling" (static)

**Features:**
- Green success dot (`<span class="dot success">`)
- Key-value list format
- Bold values

---

## Styling Architecture

### Color Scheme
```css
--bg: #fff
--text: #1f2937
--muted: #6b7280
--ring: #e5e7eb
--indigo: #667eea
--accent: #764ba2
--green: #10b981
--orange: #f59e0b
--pink: #ec4899
--blue: #3b82f6
--purple: #8b5cf6
```

### Typography
- KPI Title: 12px, uppercase, grey, bold
- KPI Value: 26px, black, extra bold
- Table headers: 12px, uppercase, grey
- Card titles: Bold with emoji icon

### Layout
- Grid systems: `grid-template-columns`
  - KPI: `repeat(auto-fit, minmax(240px, 1fr))`
  - 2-column: `1fr 1fr`
- Gap: 16px between cards
- Padding: 16px inside cards
- Responsive: Stacks on mobile (<900px)

### Animation & Interactions
- Card hover: `translateY(-2px)` + enhanced shadow
- Table row hover: shadow + `translateY(-1px)`
- Smooth transitions: 0.2s ease
- Meter animations: width transition 0.4s ease

---

## Data Dependencies

### From analyticsService
```javascript
{
    totalServers: number,
    totalTranslations: number,
    dailyStats: { [date: string]: { translations: number } },
    languageUsage: { [pair: string]: number },
    commandUsage: { [command: string]: number },
    channelActivity: { [channelId: string]: number },
    serverList: Array<{ name, memberCount, joinedAt }>,
    botStartTime: Date
}
```

### From Discord client
- `client.guilds.cache` - Server collection
- `client.channels.cache` - Channel collection
- `guild.memberCount` - Total members per guild
- `channel.name` - Channel names
- `channel.guild.name` - Server names for channels

### From process
- `process.uptime()` - System uptime
- `process.memoryUsage()` - Memory stats
- `process.version` - Node.js version
- `process.platform` - OS platform
- `process.arch` - Architecture

---

## JavaScript Functions

### Chart Initialization
```javascript
(function(){
  try {
    const ctx = document.getElementById('translationsTrendChart');
    if (ctx && window.Chart) {
      const labels = [/* chart labels */];
      const data = [/* chart data */];
      const chart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [/* config */] },
        options: { /* responsive, scales, plugins */ }
      });
    }
  } catch (e) { /* no-op */ }
})();
```

**Features:**
- IIFE (Immediately Invoked Function Expression)
- Safe error handling
- Checks for Chart.js availability
- Responsive configuration

---

## Calculated Metrics

### Uptime Formatting
```javascript
const uptime = process.uptime();
const uptimeHours = Math.floor(uptime / 3600);
const uptimeMinutes = Math.floor((uptime % 3600) / 60);
const uptimeSeconds = Math.floor(uptime % 60);
```

### Member Statistics
```javascript
const totalMembers = client ? client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0) : 0;
const totalChannels = client ? client.channels.cache.size : 0;
const activeChannels = Object.keys(analytics.channelActivity || {}).length;
const avgTranslationsPerDay = recentDays.length > 0 ? 
    Math.round(recentDays.reduce((sum, [_, stats]) => sum + (stats.translations || 0), 0) / recentDays.length) : 0;
const peakDayTranslations = Object.values(analytics.dailyStats || {})
    .reduce((max, day) => Math.max(max, day.translations || 0), 0);
```

### Coverage Calculation
```javascript
const coverage = totalChannels > 0 ? Math.round((activeChannels / totalChannels) * 100) : 0;
```

---

## Integration Points

### Required Libraries
- Chart.js (CDN or bundled) - for trend visualization
- Must be loaded before analytics tab initialization

### Analytics Service
- Must provide comprehensive `analytics` object
- Updated periodically (cache: 60s TTL)
- Includes daily stats, language usage, command usage, channel activity

### Discord Client
- Must be passed to `generateAnalyticsContent(analytics, client)`
- Used for real-time guild/channel name resolution
- Fallback to IDs if client unavailable

---

## Future Enhancements
- Real-time chart updates (WebSocket integration)
- Export analytics data (CSV/JSON)
- Custom date range selector
- Additional chart types (pie, bar)
- Comparative analytics (week-over-week, month-over-month)
- Top users analytics
- Error rate tracking
