# 🚀 Oracle Bot Deployment Commands

## Quick Deployment Steps

### 1️⃣ Update Code from Git

```bash
# Stop the bot
pm2 stop air-translator

# Go to directory
cd ~/AirTranslator

# Pull latest code
git pull origin main

# If that fails, force reset
git fetch --all
git reset --hard origin/main

# Verify the new code is there (should show the environment check code)
grep "Environment Check" src/events/ready.js
```

### 2️⃣ Install Dependencies

```bash
# Install all dependencies
npm install --legacy-peer-deps

# Option 1: Update to newer prism-media that supports opusscript 0.1.x
npm install prism-media@latest --legacy-peer-deps

# Option 2: Downgrade opusscript to match prism-media
npm install opusscript@0.0.8 --legacy-peer-deps
```

### 3️⃣ Configure Environment Variables

```bash
# Edit .env file
nano .env
```

**Required Environment Variables:**

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_actual_bot_token
CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# Dashboard API Configuration
BOT_API_SECRET=your_secure_random_string
BOT_API_PORT=3001

# Production URLs - Update with your domain
FRONTEND_URL=https://airtranslator.brevios.com
DASHBOARD_REDIRECT_URI=https://airtranslator-server.duckdns.org/api/auth/callback

# Mistral AI
MISTRAL_API_KEY=your_mistral_key

# Database
MONGODB_URI=your_mongodb_uri

# Environment
NODE_ENV=production
```

**Important:** 
- `FRONTEND_URL` = Your Vercel website URL
- `DASHBOARD_REDIRECT_URI` = Your bot's OAuth callback URL (this server)
- Update Discord Developer Portal with the same `DASHBOARD_REDIRECT_URI`

### 4️⃣ Restart Bot

```bash
# Delete pm2 from memory
pm2 delete air-translator

# Start fresh
pm2 start src/bot.js --name air-translator

# Save PM2 configuration
pm2 save

# Watch logs - you should see "🔧 Environment Check:" 
pm2 logs air-translator --lines 50
```

---

## 🔍 Monitoring & Debugging

```bash
# Check bot status
pm2 status

# View real-time logs
pm2 logs air-translator

# View last 50 lines of logs
pm2 logs air-translator --lines 50

# Restart without code changes
pm2 restart air-translator

# Check if port 3001 is listening
sudo netstat -tulpn | grep 3001

# Test API health locally
curl http://localhost:3001/api/health
```

---

## 🌐 Optional: HTTPS Setup with Nginx

For production, it's recommended to use HTTPS. Here's how to set up Nginx as a reverse proxy with free SSL from Let's Encrypt:

### Install Nginx and Certbot

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
```

### Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/airtranslator
```

Add this configuration:

```nginx
server {
    server_name airtranslator-server.duckdns.org;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
```

### Enable Site and Get SSL

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/airtranslator /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Get free SSL certificate
sudo certbot --nginx -d airtranslator-server.duckdns.org

# Certbot will automatically configure HTTPS
```

### Update Environment After SSL

After SSL is set up, update your `.env`:

```env
# Remove :3001 since Nginx handles ports
DASHBOARD_REDIRECT_URI=https://airtranslator-server.duckdns.org/api/auth/callback
```

Then restart the bot:
```bash
pm2 restart air-translator
```

---

## 📋 Post-Deployment Checklist

- [ ] Bot is running: `pm2 status` shows "online"
- [ ] API is accessible: Visit `https://airtranslator-server.duckdns.org/api/health`
- [ ] Environment variables are set correctly in `.env`
- [ ] Discord Developer Portal has the correct redirect URI
- [ ] Vercel website has `VITE_BOT_API_URL` environment variable
- [ ] MongoDB connection is working (check logs)
- [ ] Dashboard login works from the website

---

## 🆘 Common Issues

### Bot won't start
```bash
# Check logs for errors
pm2 logs air-translator --err

# Verify Node version (should be 16+)
node --version

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### Port 3001 already in use
```bash
# Find process using port 3001
sudo lsof -i :3001

# Kill the process (replace PID with actual process ID)
sudo kill -9 PID
```

### PM2 not persisting after reboot
```bash
# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
# Follow the command it outputs
```

---

## 📚 Additional Resources

- [Full Deployment Guide](../DEPLOYMENT_GUIDE.md)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [PM2 Documentation](https://pm2.keymetrics.io/)
- [DuckDNS Setup](https://www.duckdns.org/)
