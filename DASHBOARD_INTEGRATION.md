# Dashboard Integration Complete ✅

The dashboard is now fully integrated with your Discord bot!

## What Was Added

### 1. Bot API Server (bot.js)
- Express server running on port 3001
- CORS enabled for your dashboard domain
- 12 API endpoints for dashboard operations
- Starts automatically when bot is ready

### 2. Database Helper Functions (databaseService.js)
- `getServerSettings(serverId)` - Retrieve server configuration
- `updateServerSettings(serverId, updates)` - Update server settings
- `createSetup(serverId, name, channels, languages)` - Create translation setup
- `deleteSetup(serverId, setupId)` - Delete translation setup

### 3. Environment Configuration
New variables in `.env.example`:
```
BOT_API_SECRET=generate_a_secure_random_string_here
BOT_API_PORT=3001
DASHBOARD_URL=https://airtranslator.brevios.com
```

## Installation Steps

### On Oracle (Bot Server)

1. **Install dependencies**:
```bash
cd discord-translator-bot
npm install
```

2. **Update your .env file**:
```bash
# Add these lines to your .env file
BOT_API_SECRET=<generate-a-strong-random-string>
BOT_API_PORT=3001
DASHBOARD_URL=https://airtranslator.brevios.com
```

3. **Restart the bot**:
```bash
pm2 restart discord-bot
# or
npm start
```

4. **Verify API is running**:
```bash
curl http://localhost:3001/api/health
# Should return: {"status":"ok"}
```

### On Vercel (Dashboard)

1. **Set environment variables in Vercel dashboard**:
   - `DISCORD_CLIENT_ID` = 1380177061032759416
   - `DISCORD_CLIENT_SECRET` = <your-discord-client-secret>
   - `DISCORD_REDIRECT_URI` = https://airtranslator.brevios.com/api/auth/callback
   - `BOT_API_URL` = http://<your-oracle-ip>:3001
   - `BOT_API_SECRET` = <same-value-as-bot-env>
   - `SESSION_SECRET` = <generate-random-string>

2. **Deploy the dashboard**:
```bash
cd website
git add .
git commit -m "Add dashboard features"
git push
# Vercel will auto-deploy
```

## API Endpoints

All endpoints are prefixed with `/api`:

### Server Management
- `GET /servers` - List all servers bot is in
- `GET /servers/:id` - Get specific server settings
- `POST /servers/:id/setups` - Create translation setup
- `DELETE /servers/:id/setups/:setupId` - Delete setup
- `PATCH /servers/:id/globalmode` - Toggle global mode
- `PATCH /servers/:id/autocleanup` - Update auto cleanup
- `PATCH /servers/:id/advanced` - Update advanced settings
- `PATCH /servers/:id/stt` - Update speech-to-text settings

### Personal Settings
- `GET /personalbuddy/:userId` - Get personal translation settings
- `POST /personalbuddy/:userId` - Update personal translation

### Voting
- `GET /vote/status/:userId` - Check user vote status

### Health Check
- `GET /health` - API health status

## Architecture Flow

```
User Browser
    ↓
Dashboard (Vercel - React)
    ↓
Vercel API Routes (/api/*)
    ↓
Discord OAuth / Session Check
    ↓
Bot API (Oracle - Express) :3001
    ↓
Database Service
    ↓
MongoDB
```

## Security Features

✅ Discord OAuth 2.0 authentication
✅ HTTP-only secure cookies
✅ API secret validation between Vercel and bot
✅ CORS restricted to dashboard domain
✅ Server membership verification
✅ User permission checks

## Testing

1. **Login**: Visit https://airtranslator.brevios.com/dashboard
2. **OAuth**: Should redirect to Discord login
3. **Servers**: After login, should see server list
4. **Settings**: Click server → should load all settings
5. **Modifications**: Try toggling global mode, creating setup, etc.

## Troubleshooting

### Dashboard shows "Failed to fetch servers"
- Check BOT_API_URL in Vercel env vars
- Verify bot API is running: `curl http://localhost:3001/api/health`
- Check firewall allows connections to port 3001

### "Unauthorized" errors
- Verify BOT_API_SECRET matches on both Vercel and Oracle
- Check Discord OAuth credentials in Vercel

### Settings not saving
- Check MongoDB connection in bot logs
- Verify databaseService functions are working
- Check bot API logs for errors

## Files Modified

### Bot Files
- `discord-translator-bot/package.json` - Added cors dependency
- `discord-translator-bot/src/bot.js` - Added dashboard API server
- `discord-translator-bot/src/services/databaseService.js` - Added helper functions
- `discord-translator-bot/src/services/dashboardApi.js` - API endpoints (created earlier)
- `discord-translator-bot/.env.example` - Added dashboard config

### Website Files
- `website/src/pages/Dashboard.jsx` - Main dashboard
- `website/src/pages/Login.jsx` - OAuth login
- `website/src/components/dashboard/*` - Dashboard UI components
- `website/api/*` - Vercel serverless functions
- `website/vercel.json` - Routing configuration

## Support

If you encounter issues:
1. Check bot logs: `pm2 logs discord-bot`
2. Check Vercel logs: Vercel dashboard → Deployments → Logs
3. Verify environment variables are set correctly
4. Test API directly: `curl http://localhost:3001/api/health`

---

🎉 **Your dashboard is ready to use!**
