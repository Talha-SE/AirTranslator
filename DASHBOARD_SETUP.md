# User Dashboard Setup Guide

This guide will help you set up and test the new Discord OAuth user dashboard for AirTranslator.

## Prerequisites

1. Discord Application with OAuth2 configured
2. MongoDB instance (local or Atlas)
3. Node.js 18+ installed
4. Bot already running and added to at least one Discord server

## Step 1: Configure Discord OAuth2

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your AirTranslator application
3. Go to **OAuth2** → **General**
4. Add the following redirect URI:
   - For local development: `http://localhost:5173/auth/callback`
   - For production: `https://your-domain.com/auth/callback`
5. Copy your **Client Secret** (keep this secure!)

## Step 2: Configure Environment Variables

### Backend (.env in root directory)

Add these OAuth-related variables to your `.env` file:

```env
# Existing Discord Bot Config
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here

# NEW: Discord OAuth2 Configuration
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=http://localhost:5173/auth/callback
FRONTEND_URL=http://localhost:5173

# Existing MongoDB Config
MONGODB_URI=your_mongodb_uri_here

# Other existing config...
```

### Frontend (website/.env)

Create a `.env` file in the `website/` folder:

```env
VITE_API_URL=http://localhost:3000
```

## Step 3: Install Dependencies

```bash
# Install backend dependencies (if not already done)
npm install --legacy-peer-deps

# Install frontend dependencies
cd website
npm install
cd ..
```

## Step 4: Start the Bot Backend

In the root directory:

```bash
npm start
```

The bot should start and the API server will be available at `http://localhost:3000`.

You should see output like:
```
🏥 Health check server running on port 3000
🔐 Admin panel: http://localhost:3000/admin
```

## Step 5: Start the Frontend Dashboard

In a new terminal, navigate to the website folder:

```bash
cd website
npm run dev
```

The dashboard will be available at `http://localhost:5173`.

You should see output like:
```
VITE v7.3.1  ready in xxx ms

➜  Local:   http://localhost:5173/
```

## Step 6: Test the OAuth Flow

1. **Open the dashboard** at `http://localhost:5173`
2. **Click "Login with Discord"** - You'll be redirected to Discord
3. **Authorize the application** - Grant permissions
4. **You'll be redirected back** to the dashboard at `/auth/callback` and then to `/dashboard`
5. **View your servers** - You should see a list of servers where the bot is installed
6. **Select a server** - Click on a server card
7. **View channels** - You should see all text channels in that server with their names (not IDs)
8. **View configuration** - If you have any translation setups, they'll be displayed

## Troubleshooting

### "Authentication failed" error

- **Check Discord Client Secret**: Make sure `DISCORD_CLIENT_SECRET` in `.env` matches your application's secret
- **Check Redirect URI**: Make sure the redirect URI in Discord Developer Portal matches `DISCORD_REDIRECT_URI` in `.env`
- **Check CORS**: Make sure `FRONTEND_URL` in `.env` matches your frontend URL

### "No servers found"

- **Bot not in servers**: The bot needs to be invited to at least one Discord server
- **User not in bot servers**: The logged-in Discord user must be a member of a server where the bot is also present
- **Permissions**: The user needs MANAGE_GUILD or ADMINISTRATOR permission to see the server in the dashboard

### "Failed to load channels"

- **Bot not in guild**: Make sure the bot is still in the selected server
- **Bot permissions**: The bot needs permission to view channels

### Backend not starting

- **Check MongoDB**: Make sure MongoDB is running and `MONGODB_URI` is correct
- **Check port**: Make sure port 3000 is not already in use
- **Check dependencies**: Run `npm install --legacy-peer-deps` again

### Frontend not starting

- **Check Node version**: Make sure you have Node.js 18+
- **Check dependencies**: Run `npm install` in the website folder again
- **Check port**: Make sure port 5173 is not already in use

## API Endpoints

The following API endpoints are now available:

- `GET /api/auth/discord` - Get Discord OAuth URL
- `POST /api/auth/callback` - Handle OAuth callback
- `GET /api/user/me` - Get current user info
- `GET /api/user/guilds` - Get user's guilds (where bot is present)
- `GET /api/guilds/{guildId}/channels` - Get channels for a guild
- `GET /api/guilds/{guildId}/config` - Get translation config for a guild
- `PUT /api/guilds/{guildId}/config` - Update translation config (future feature)
- `POST /api/auth/logout` - Logout user

## Features Implemented

✅ **Discord OAuth Login** - Secure authentication via Discord
✅ **Server List** - Shows only servers where bot is installed
✅ **Channel Names** - Displays channel names instead of IDs
✅ **Dynamic Channel Fetching** - Channels are fetched live when a server is selected
✅ **Translation Setups** - View existing translation configurations
✅ **Responsive UI** - Modern, mobile-friendly interface
✅ **Session Management** - 7-day session persistence

## Production Deployment

For production deployment:

1. Update environment variables:
   ```env
   # Backend .env
   DISCORD_REDIRECT_URI=https://your-frontend-domain.com/auth/callback
   FRONTEND_URL=https://your-frontend-domain.com
   NODE_ENV=production
   ```

   ```env
   # Frontend .env
   VITE_API_URL=https://your-backend-domain.com
   ```

2. Build the frontend:
   ```bash
   cd website
   npm run build
   ```

3. Deploy the `website/dist` folder to a static host (Vercel, Netlify, etc.)

4. Deploy the backend to your server (Render, Heroku, etc.)

5. Update the Discord OAuth redirect URI in the Developer Portal

## Next Steps

The dashboard is now ready for:
- Adding new translation setups via UI (future feature)
- Editing existing setups (future feature)
- Managing channel configurations (future feature)
- Premium features (future feature)

Currently, users should still use Discord slash commands to create setups, but they can view them in the dashboard.
