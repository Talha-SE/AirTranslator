# 🚀 Quick Start - Dashboard Setup

## Prerequisites
- Bot running on Oracle server
- Website deployed on Vercel
- Discord OAuth credentials

## 5-Minute Setup

### Step 1: Configure Bot (.env)

Add these lines to `discord-translator-bot/.env`:

```bash
# Dashboard API Configuration
BOT_API_SECRET=YOUR_SECURE_RANDOM_STRING_HERE
BOT_API_PORT=3001
DASHBOARD_URL=https://airtranslator.brevios.com
```

**Generate secure secret:**
```bash
# Linux/Mac
openssl rand -hex 32

# Windows PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

### Step 2: Restart Bot

```bash
cd discord-translator-bot
npm install --legacy-peer-deps
pm2 restart discord-bot
# or
npm start
```

### Step 3: Configure Vercel

Go to Vercel dashboard → Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `DISCORD_CLIENT_ID` | `1380177061032759416` |
| `DISCORD_CLIENT_SECRET` | Get from Discord Developer Portal |
| `DISCORD_REDIRECT_URI` | `https://airtranslator.brevios.com/api/auth/callback` |
| `BOT_API_URL` | `http://YOUR_ORACLE_IP:3001` |
| `BOT_API_SECRET` | Same as bot's BOT_API_SECRET |
| `SESSION_SECRET` | Generate new random string |

### Step 4: Deploy Website

```bash
cd website
git add .
git commit -m "Dashboard integration complete"
git push
```

Vercel will auto-deploy.

### Step 5: Test

1. Visit **https://airtranslator.brevios.com**
2. Click **Dashboard** button
3. Login with Discord
4. You should see your servers!

## Quick Health Check

```bash
# Test bot API is running
curl http://localhost:3001/api/health

# Expected response:
{"status":"ok"}
```

## Troubleshooting

### Can't see servers
- Check `BOT_API_URL` in Vercel matches your Oracle IP
- Verify port 3001 is open in firewall

### Authentication errors
- Verify `BOT_API_SECRET` matches on both Vercel and Oracle
- Check Discord OAuth credentials

### Settings not saving
- Check MongoDB connection in bot logs
- Verify bot has restarted with new code

## Features Available

✅ Server Management
- View all servers
- Translation setups (create/delete)
- Global mode toggle
- Auto cleanup settings
- Tone understanding
- Thread style translation

✅ Personal Settings
- Personal Buddy languages
- User-specific translations

✅ Voting
- Vote status check
- Premium features tracking

✅ Speech-to-Text
- STT enable/disable
- Language configuration

## Next Steps

- [ ] Test creating a translation setup
- [ ] Toggle global mode
- [ ] Configure personal buddy
- [ ] Check vote status
- [ ] Enable STT for a channel

## Need Help?

Check [DASHBOARD_INTEGRATION.md](./DASHBOARD_INTEGRATION.md) for detailed documentation.

---

**🎉 Setup complete! Your dashboard is now live!**
