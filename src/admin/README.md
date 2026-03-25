# AirTranslator Admin Panel

A modern, responsive admin panel for managing the AirTranslator Discord bot with dark/light theme support, comprehensive analytics, and powerful management tools.

## 🎨 Features

- **Modern UI/UX**: Clean, intuitive interface with smooth animations
- **Dark/Light Theme**: Toggle between themes with persistent preference
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Collapsible Sidebar**: Maximize screen space when needed
- **Real-time Analytics**: Live stats and metrics
- **Server Management**: View, filter, and manage all bot servers
- **Message Broadcasting**: Send announcements to all or specific servers
- **Monetization Controls**: Manage premium features, exemptions, and vote rewards
- **Activity Logging**: Track all important bot activities

## 📁 Project Structure

```
src/admin/
├── server.js                    # Main HTTP server with routing
├── auth.js                      # Authentication & session management
├── handlers/                    # Route handlers
│   ├── analytics.js            # Analytics endpoints
│   ├── messaging.js            # Message broadcasting & scheduling
│   ├── monetization.js         # Premium & monetization management
│   └── servers.js              # Server management endpoints
├── templates/                   # HTML generation
│   ├── login.js                # Login page template
│   ├── layout.js               # Base layout with sidebar & header
│   └── dashboard.js            # Dashboard with all tabs
└── public/                      # Static assets
    ├── styles.css              # Modern CSS with theme support
    └── app.js                  # Interactive JavaScript
```

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ installed
- Discord bot token configured
- Environment variables set (see `.env.example`)

### Environment Variables

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YourSecurePassword123!
PORT=3000
TOPGG_WEBHOOK_SECRET=your_webhook_secret
```

### Running the Admin Panel

The admin panel starts automatically when you run the bot:

```bash
npm start
```

Access the panel at: `http://localhost:3000/admin`

## 🔐 Authentication

Default credentials (change these in production!):
- **Username**: admin
- **Password**: AirTranslator2024!

Sessions expire after 24 hours. Use "Remember me" to save your username.

## 📊 Dashboard Tabs

### 1. Analytics
- **Overview Stats**: Total translations, active servers, users, uptime
- **Activity Charts**: Translation trends over time
- **Top Languages**: Most used translation languages
- **Recent Activity**: Real-time activity feed

### 2. Messaging
- **Compose Messages**: Create custom announcements
- **Templates**: Pre-built message templates (announcements, updates, maintenance, etc.)
- **Targeting**: Send to all servers, specific servers, or filtered groups
- **Scheduling**: Schedule messages for later delivery
- **Live Preview**: See exactly how your message will look
- **Auto Setup**: Send guided setup flows to servers

### 3. Monetization
- **Vote Statistics**: Track bot votes and rewards
- **Premium Requests**: Approve or reject premium access requests
- **Exemptions**: Manage servers with unlimited translations
- **Restrictions**: Control which servers have limited access
- **Custom Limits**: Set per-server translation limits
- **Bulk Actions**: Perform actions across all servers at once

### 4. Servers
- **Server List**: View all servers the bot is in
- **Search & Filter**: Quickly find specific servers
- **Server Details**: View member counts, join dates
- **Server Actions**: Leave servers, view members
- **Real-time Data**: Auto-refreshing server information

### 5. Activity Log
- **Event Timeline**: Chronological list of all bot activities
- **Filter Options**: Filter by event type
- **Export Logs**: Download logs for analysis
- **Color-Coded**: Easy visual identification of event types

## 🎨 Theme System

The admin panel supports light and dark themes:

- Click the sun/moon icon in the header to toggle
- Theme preference is saved to localStorage
- Automatically adapts to system preferences
- All colors use CSS variables for easy customization

### Customizing Colors

Edit `public/styles.css` and modify the CSS variables:

```css
:root {
    --primary: #6366f1;        /* Main brand color */
    --success: #10b981;        /* Success messages */
    --warning: #f59e0b;        /* Warnings */
    --danger: #ef4444;         /* Errors/danger actions */
    /* ... more variables */
}
```

## 📱 Responsive Design

The admin panel is fully responsive:

- **Desktop** (>768px): Full sidebar with all features
- **Tablet** (768px - 1024px): Collapsible sidebar
- **Mobile** (<768px): Slide-out menu with overlay

## 🔧 API Endpoints

### Public Endpoints
- `GET /health` - Health check
- `GET /ping` - Simple ping
- `POST /webhook/vote` - Top.gg vote webhook
- `POST /webhooks/topgg` - Alias for the Top.gg vote webhook

### Authentication
- `POST /admin/login` - User login
- `GET /admin/logout` - User logout

### Protected Endpoints (Require Authentication)
- `GET /admin` - Dashboard
- `GET /admin/metrics` - Analytics data
- `GET /admin/servers` - Server list
- `POST /admin/send-message` - Send broadcast message
- `POST /admin/schedule-message` - Schedule message
- `POST /admin/servers/leave` - Leave a server
- `POST /admin/monetization/*` - Monetization actions
- And many more...

## 🛡️ Security Features

- **Session-based Authentication**: Secure HTTP-only cookies
- **Session Expiry**: Automatic 24-hour expiration
- **Session Sweeping**: Removes old sessions to prevent memory leaks
- **CSRF Protection**: Built-in protections
- **Rate Limiting**: Prevents abuse (coming soon)
- **Secure Password Storage**: Use environment variables

## 🎯 Best Practices

1. **Change Default Credentials**: Always update admin credentials in production
2. **Use HTTPS**: Enable HTTPS in production with a reverse proxy
3. **Regular Backups**: Back up your data regularly
4. **Monitor Logs**: Check activity logs for suspicious activity
5. **Keep Dependencies Updated**: Run `npm audit` regularly

##  Performance

- **Caching**: Dashboard HTML is cached for 60 seconds
- **Lazy Loading**: Data loads on-demand
- **Optimized Assets**: Minified CSS and JavaScript
- **Efficient Queries**: Database queries are optimized
- **Memory Management**: Automatic cleanup of old sessions

## 🐛 Troubleshooting

### Can't Login
- Check `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables
- Clear browser cookies and try again
- Check server logs for authentication errors

### Sidebar Not Working
- Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
- Clear browser cache
- Check browser console for JavaScript errors

### Theme Not Saving
- Check if localStorage is enabled in your browser
- Try a different browser
- Clear site data and try again

### Data Not Loading
- Check if the bot is running and connected to Discord
- Verify database connection
- Check server logs for errors

## 📝 Development

### Adding a New Tab

1. Create tab content in `templates/dashboard.js`:
```javascript
function generateMyNewTab() {
    return `<div class="tab-content">...</div>`;
}
```

2. Add nav item in `templates/layout.js`:
```javascript
<a href="/admin?tab=mynew" class="nav-item" data-tab="mynew">
    <svg class="nav-icon">...</svg>
    <span class="nav-text">My New Tab</span>
</a>
```

3. Handle in dashboard generator:
```javascript
case 'mynew':
    tabContent = generateMyNewTab();
    break;
```

### Adding a New API Endpoint

1. Create handler in appropriate `handlers/*.js` file
2. Add route in `server.js`
3. Add client-side function in `public/app.js`

## 📄 License

This admin panel is part of the AirTranslator project.

---

**Made with ❤️ for the AirTranslator community**
