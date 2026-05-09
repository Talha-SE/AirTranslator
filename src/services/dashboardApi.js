// Create a backend API on the Oracle bot server to handle dashboard requests
// This file should be added to the bot's src/services/ folder

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const {
  getServerSettings,
  updateServerSettings,
  createSetup,
  deleteSetup,
  createServerSetup,
  deleteServerSetup,
  getPersonalTranslationSettings,
  togglePersonalTranslation,
  getFeedbackSettings,
  hasSubmittedFeedback,
  createUserFeedback
} = require('./databaseService');
const STTSettings = require('../models/STTSettings');
const monetizationService = require('./monetizationService');

const router = express.Router();

// Discord OAuth Configuration
const DISCORD_CLIENT_ID = process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DASHBOARD_REDIRECT_URI || 'http://localhost:3001/api/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const DISCORD_API = 'https://discord.com/api/v10';
const MANAGE_GUILD_PERMISSION = BigInt(0x0000000000000020);
const DEFAULT_INVITE_PERMISSIONS = process.env.BOT_INVITE_PERMISSIONS || '8';
const SUPPORT_SERVER_INVITE_CODE = 'WeynxzR9nq';
const SUPPORT_SERVER_GUILD_ID = process.env.SUPPORT_SERVER_GUILD_ID; // optional, resolved from invite if not set

// Session storage (file-backed for persistence)
const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');
const sessions = new Map();

// Ensure data directory exists
const dataDir = path.dirname(SESSIONS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Load sessions from disk
try {
    if (fs.existsSync(SESSIONS_FILE)) {
        const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
        const entries = JSON.parse(data);
        entries.forEach(([key, value]) => sessions.set(key, value));
        console.log(`Loaded ${sessions.size} sessions from disk.`);
    }
} catch (err) {
    console.error('Failed to load sessions:', err);
}

// Helper to save sessions
function saveSessions() {
    try {
        const entries = Array.from(sessions.entries());
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(entries), 'utf8');
    } catch (err) {
        console.error('Failed to save sessions:', err);
    }
}

// Helper to generate session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function hasManageGuildPermission(permissions) {
  try {
    return (BigInt(permissions || 0) & MANAGE_GUILD_PERMISSION) !== BigInt(0);
  } catch {
    return false;
  }
}

function buildBotInviteUrl(guildId) {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    permissions: DEFAULT_INVITE_PERMISSIONS,
    scope: 'bot applications.commands'
  });

  if (guildId) {
    params.set('guild_id', guildId);
  }

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function buildAccessibleGuilds(session, client, { fetchMissingGuilds = false } = {}) {
  if (!session?.accessToken || !client) {
    return session?.guilds || [];
  }

  const guildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });

  const userGuilds = guildsResponse.data || [];
  const manageableGuilds = userGuilds.filter(guild => hasManageGuildPermission(guild.permissions));
  const botGuildIds = new Set(client.guilds.cache.map(g => g.id));

  const accessibleMap = new Map();
  manageableGuilds.forEach(guild => {
    if (botGuildIds.has(guild.id)) {
      accessibleMap.set(guild.id, guild);
    }
  });

  if (fetchMissingGuilds) {
    const missingGuilds = manageableGuilds.filter(guild => !accessibleMap.has(guild.id)).slice(0, 30);
    const recoveredGuilds = await Promise.all(
      missingGuilds.map(async guild => {
        const fetched = await client.guilds.fetch(guild.id).catch(() => null);
        return fetched ? guild : null;
      })
    );

    recoveredGuilds.forEach(guild => {
      if (guild) {
        accessibleMap.set(guild.id, guild);
      }
    });
  }

  return Array.from(accessibleMap.values());
}

async function refreshSessionGuilds(session, options = {}) {
  const client = router.botClient;
  if (!session || !client) {
    return session?.guilds || [];
  }

  const refreshedGuilds = await buildAccessibleGuilds(session, client, options);
  session.guilds = refreshedGuilds;
  return refreshedGuilds;
}

// Discord OAuth - Start authentication
router.get('/auth/discord', (req, res) => {
  const state = generateSessionId();
  const join = req.query.join === '1';
  const scope = join ? 'identify guilds guilds.join' : 'identify guilds';
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope,
    state
  });
  
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
});

/**
 * Auto-join user to the support server using the guilds.join scope
 */
async function joinSupportServer(accessToken, userId) {
  try {
    const client = router.botClient;
    if (!client) {
      console.warn('joinSupportServer: bot client not available');
      return false;
    }

    let guildId = SUPPORT_SERVER_GUILD_ID;
    if (!guildId) {
      const inviteRes = await axios.get(`${DISCORD_API}/invites/${SUPPORT_SERVER_INVITE_CODE}`, {
        params: { with_counts: false, with_expiration: false }
      });
      guildId = inviteRes.data.guild_id;
    }

    await axios.put(
      `${DISCORD_API}/guilds/${guildId}/members/${userId}`,
      { access_token: accessToken },
      {
        headers: {
          Authorization: `Bot ${client.token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Auto-joined user ${userId} to support server (${guildId})`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to auto-join user ${userId} to support server: ${error.response?.data?.message || error.message}`);
    return false;
  }
}

// Discord OAuth - Callback
router.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.redirect('http://localhost:5173/login?error=no_code');
  }

  try {
    // Exchange code for token
    const tokenResponse = await axios.post(`${DISCORD_API}/oauth2/token`, 
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    // Get bot client from global scope
    const client = router.botClient;
    
    if (!client) {
      return res.redirect(`${FRONTEND_URL}/login?error=bot_not_ready`);
    }

    const sessionSeed = { accessToken: access_token, guilds: [] };
    const accessibleGuilds = await buildAccessibleGuilds(sessionSeed, client, { fetchMissingGuilds: true });

    // Create session
    const sessionId = generateSessionId();
    const expiresAt = Date.now() + (expires_in * 1000);
    
    sessions.set(sessionId, {
      user: userResponse.data,
      guilds: accessibleGuilds, // Only guilds where bot is in AND user has manage permission
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt
    });
    
    saveSessions();

    // Auto-join support server if user granted guilds.join scope
    if (scope && scope.includes('guilds.join')) {
      joinSupportServer(access_token, userResponse.data.id);
    }

    // Redirect back to frontend with session ID
    res.redirect(`${FRONTEND_URL}/auth/success?session=${sessionId}`);
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
});

// Get current user session
router.get('/auth/user', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = sessions.get(sessionId);
  
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    saveSessions();
    return res.status(401).json({ error: 'Session expired' });
  }

  if (req.query.refresh === '1') {
    try {
      await refreshSessionGuilds(session, { fetchMissingGuilds: true });
      saveSessions();
    } catch (error) {
      console.warn('Failed to refresh guild list from Discord API:', error.message || error);
    }
  }

  res.json({
    user: session.user,
    guilds: session.guilds || []
  });
});

// Refresh session guild access list
router.post('/auth/refresh-guilds', verifySession, async (req, res) => {
  try {
    const guilds = await refreshSessionGuilds(req.userSession, { fetchMissingGuilds: true });
    saveSessions();
    res.json({ guilds });
  } catch (error) {
    console.error('Error refreshing guild list:', error);
    res.status(500).json({ error: 'Failed to refresh guilds' });
  }
});

// Build bot invite URL for adding to more servers
router.get('/auth/invite-url', verifySession, async (req, res) => {
  const guildId = req.query.guildId;
  res.json({ inviteUrl: buildBotInviteUrl(guildId) });
});

// Logout
router.post('/auth/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  
  if (sessionId) {
    sessions.delete(sessionId);
    saveSessions();
  }
  
  res.json({ success: true });
});

// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware to verify user session
function verifySession(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = sessions.get(sessionId);
  
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    saveSessions();
    return res.status(401).json({ error: 'Session expired' });
  }

  // Attach session to request
  req.userSession = session;
  next();
}

// Middleware to verify user has access to specific server
async function verifyServerAccess(req, res, next) {
  const { serverId } = req.params;
  const session = req.userSession;
  
  // Check if user has access to this server
  let hasAccess = (session.guilds || []).some(guild => guild.id === serverId);

  if (!hasAccess) {
    try {
      await refreshSessionGuilds(session, { fetchMissingGuilds: true });
      saveSessions();
      hasAccess = (session.guilds || []).some(guild => guild.id === serverId);
    } catch (error) {
      console.warn('verifyServerAccess refresh failed:', error.message || error);
    }
  }
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this server' });
  }
  
  next();
}

// Middleware to verify API secret (for production Vercel API calls)
function verifyApiSecret(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiSecret = process.env.BOT_API_SECRET;

  // In development with user session, skip API secret check
  if (req.userSession) {
    return next();
  }

  // In production, require API secret from Vercel
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  if (token !== apiSecret) {
    return res.status(403).json({ error: 'Invalid API secret' });
  }

  next();
}

const FEEDBACK_OPTIONS = {
  dashboardExperience: new Set(['love_it', 'okay', 'needs_work']),
  planType: new Set(['free', 'paid', 'trial']),
  usageReason: new Set(['community', 'gaming', 'business', 'friends', 'other']),
  recommendScore: new Set(['yes', 'maybe', 'no'])
};

function normalizeFeedbackValue(value) {
  return (value || '').toString().trim().toLowerCase();
}

function sanitizeFeedbackText(value, maxLength = 500) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// Apply session verification to all /servers routes
router.use('/servers/:serverId', verifySession, verifyServerAccess);

// Get server settings
router.get('/servers/:serverId', async (req, res) => {
  try {
    const { serverId } = req.params;
    let serverData = await getServerSettings(serverId);

    if (!serverData) {
      serverData = {
        serverId,
        setups: [],
        serverWideTranslation: false,
        serverWideLanguages: [],
        serverWideExcludedChannels: [],
        toneEnabledChannels: [],
        threadStyleEnabled: false,
        threadStyleChannels: [],
        autoCleanup: {
          serverWide: {
            enabled: false,
            delay: 0
          },
          channels: {}
        },
        monetization: {
          freeTranslationLimit: 20,
          isRestricted: true,
          isExempt: false,
          exemptUntil: null,
          premiumJoinedAt: null,
          lastReset: new Date(),
          customLimit: null
        }
      };
    }

    if (serverData.toObject) {
      serverData = serverData.toObject();
    }

    // Fetch STT Settings
    try {
      const sttSettings = await STTSettings.findOne({ guildId: serverId });
      if (sttSettings) {
        serverData.sttSettings = sttSettings.toObject ? sttSettings.toObject() : sttSettings;
      } else {
         serverData.sttSettings = {
             enabled: false,
             inputChannelId: null,
             outputChannelId: null,
             language1: null,
             language2: null,
             language3: null,
             flushIntervalMs: 5000
         };
      }
    } catch (err) {
      console.warn('Failed to fetch STT settings:', err);
      // Non-fatal, just set defaults
      serverData.sttSettings = { enabled: false };
    }

    // Get bot client to fetch channel names
    const client = router.botClient;
    const guild = client?.guilds.cache.get(serverId) || await client?.guilds.fetch(serverId).catch(() => null);
    
    if (guild) {
      await guild.channels.fetch().catch(() => null);

      // Enrich setups with channel names
      if (serverData.setups && serverData.setups.length > 0) {
        serverData.setups = serverData.setups.map(setup => {
          const setupValue = setup.toObject ? setup.toObject() : setup;
          const enrichedChannels = (setupValue.channels || []).map(channelRef => {
            const channelId = typeof channelRef === 'string' ? channelRef : channelRef.id;
            const channel = guild.channels.cache.get(channelId);
            return {
              id: channelId,
              name: channel ? channel.name : `Unknown Channel`,
              type: channel ? channel.type : 0
            };
          });
          
          return {
            ...setupValue,
            channels: enrichedChannels
          };
        });
      }

      // Enrich tone-enabled channels
      if (serverData.toneEnabledChannels && serverData.toneEnabledChannels.length > 0) {
        serverData.toneEnabledChannels = serverData.toneEnabledChannels.map(channelId => {
          const channel = guild.channels.cache.get(channelId);
          return {
            id: channelId,
            name: channel ? channel.name : `Unknown Channel`,
            type: channel ? channel.type : 0
          };
        });
      }

      // Add guild information
      serverData.guildName = guild.name;
      serverData.guildIcon = guild.icon;
      serverData.memberCount = guild.memberCount;
    } else {
      const guildFromSession = (req.userSession.guilds || []).find(g => g.id === serverId);
      if (guildFromSession) {
        serverData.guildName = guildFromSession.name;
        serverData.guildIcon = guildFromSession.icon || null;
      }
    }

    res.json(serverData);
  } catch (error) {
    console.error('Error fetching server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get server channels (for channel selection in dashboard)
router.get('/servers/:serverId/channels', async (req, res) => {
  try {
    const { serverId } = req.params;
    const client = router.botClient;

    if (!client) {
      return res.status(503).json({ error: 'Bot not ready' });
    }

    const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found in bot cache' });
    }

    await guild.channels.fetch().catch(() => null);

    // Return text and voice channels (filter out categories, threads, etc.)
    const channels = guild.channels.cache
      .filter(ch => [0, 2].includes(ch.type)) // 0 = GuildText, 2 = GuildVoice
      .sort((a, b) => a.position - b.position)
      .map(ch => ({
        id: ch.id,
        name: ch.name,
        type: ch.type === 0 ? 'text' : 'voice',
        category: ch.parent ? ch.parent.name : null,
        position: ch.position
      }));

    res.json({ channels });
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// Create translation setup (matching bot command format)
router.post('/servers/:serverId/setups', async (req, res) => {
  try {
    const { serverId } = req.params;
    const { name, channels, languages } = req.body;

    // Get guild from bot client for server name
    const client = router.botClient;
    const guild = client?.guilds.cache.get(serverId) || await client?.guilds.fetch(serverId).catch(() => null);
    const serverName = guild ? guild.name : 'Unknown Server';

    // Create paired arrays: each channel gets AUTO_DETECT + each language
    // This matches how quickSetup command structures the data
    const setupChannels = [];
    const setupLanguages = [];

    for (const channelId of channels) {
      // First entry: auto-detect
      setupChannels.push(channelId);
      setupLanguages.push('auto');
      
      // Then add each target language
      for (const language of languages) {
        setupChannels.push(channelId);
        setupLanguages.push(language.toLowerCase());
      }
    }

    // Use createServerSetup (same as commands)
    const result = await createServerSetup(serverId, serverName, name, setupChannels, setupLanguages);
    
    res.json({ success: true, setup: result.setup });
  } catch (error) {
    console.error('Error creating setup:', error);
    console.error('Error stack:', error.stack);
    if (error.message === 'SETUP_NAME_EXISTS') {
      return res.status(400).json({ error: 'A setup with this name already exists' });
    }
    if (error.message === 'SETUP_CONFIG_EXISTS') {
      return res.status(400).json({ error: 'A setup with this configuration already exists' });
    }
    res.status(500).json({ error: 'Failed to create setup', details: error.message });
  }
});

// Delete translation setup
router.delete('/servers/:serverId/setups/:setupId', async (req, res) => {
  console.log('[BOT API] ========== DELETE SETUP REQUEST ==========');
  console.log('[BOT API] Params:', req.params);
  console.log('[BOT API] Query:', req.query);
  
  try {
    const { serverId, setupId } = req.params;
    const { name } = req.query;

    console.log('[BOT API] Server ID:', serverId);
    console.log('[BOT API] Setup ID:', setupId);
    console.log('[BOT API] Setup Name:', name);

    let success = false;

    // First try deleting by ID if available (most precise)
    if (setupId && setupId !== 'undefined' && setupId !== 'null') {
      console.log('[BOT API] Attempting deletion by ID...');
      const deleted = await deleteSetup(serverId, setupId);
      console.log('[BOT API] Deletion by ID result:', deleted);
      if (deleted) {
        console.log('[BOT API] ✅ Deleted successfully by ID');
        success = true;
      } else {
        console.log('[BOT API] ⚠️ ID deletion returned false');
      }
    } else {
      console.log('[BOT API] ⚠️ Setup ID is invalid/missing:', setupId);
    }

    // If ID deletion didn't work (or ID was invalid), fall back strictly to Name deletion
    if (!success && name && name !== 'undefined' && name !== '') {
      console.log('[BOT API] Attempting deletion by name as fallback...');
      try {
        await deleteServerSetup(serverId, name);
        console.log('[BOT API] ✅ Deleted successfully by name');
        success = true;
      } catch (err) {
        console.error('[BOT API] ⚠️ Name deletion error:', err.message);
        // If it throws SETUP_NOT_FOUND, it might have been deleted already or name is wrong
        // If it doesn't exist, we can consider the "delete" successful (idempotent)
        if (err.message === 'SETUP_NOT_FOUND') {
            console.log('[BOT API] Setup not found, considering deletion successful (idempotent)');
            success = true;
        } else {
            throw err;
        }
      }
    } else {
      console.log('[BOT API] ⚠️ Name is invalid/missing:', name);
    }

    if (!success) {
        // Only throw if both methods failed to confirm deletion
        console.error('[BOT API] ❌ BOTH deletion methods failed');
        throw new Error('Failed to delete setup: verification failed');
    }

    console.log('[BOT API] ✅ Deletion successful');
    res.json({ success: true });
  } catch (error) {
    console.error('[BOT API] ❌ Exception during deletion:', error);
    res.status(500).json({ error: 'Failed to delete setup', details: error.message });
  }
});

// Update global mode (simple toggle)
router.post('/servers/:serverId/globalmode', async (req, res) => {
  try {
    const { serverId } = req.params;
    const { enabled } = req.body;

    await updateServerSettings(serverId, {
      serverWideTranslation: enabled,
      serverWideLanguages: [] // Languages determined from existing setups
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating global mode:', error);
    res.status(500).json({ error: 'Failed to update global mode' });
  }
});

// Update auto cleanup
router.post('/servers/:serverId/autocleanup', async (req, res) => {
  console.log('[BOT API] ========== AUTO CLEANUP UPDATE ==========');
  console.log('[BOT API] Server ID:', req.params.serverId);
  console.log('[BOT API] Body:', req.body);
  
  try {
    const { serverId } = req.params;
    const { serverWideEnabled, serverWideDelay, channelSettings } = req.body;

    console.log('[BOT API] Server-wide enabled:', serverWideEnabled);
    console.log('[BOT API] Server-wide delay (ms):', serverWideDelay);
    console.log('[BOT API] Channel settings:', channelSettings);

    const updateData = {
      'autoCleanup.serverWide.enabled': serverWideEnabled,
      'autoCleanup.serverWide.delay': serverWideDelay || 0
    };

    // If channel settings are provided, update them
    if (channelSettings) {
      updateData['autoCleanup.channels'] = channelSettings;
    }

    await updateServerSettings(serverId, updateData);

    console.log('[BOT API] ✅ Auto cleanup settings updated successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('[BOT API] ❌ Error updating auto cleanup:', error);
    res.status(500).json({ error: 'Failed to update auto cleanup' });
  }
});

// Update advanced settings
router.post('/servers/:serverId/advanced', async (req, res) => {
  console.log('[BOT API] ========== ADVANCED SETTINGS UPDATE ==========');
  console.log('[BOT API] Server ID:', req.params.serverId);
  console.log('[BOT API] Body:', req.body);
  
  try {
    const { serverId } = req.params;
    const { toneChannels, threadStyle, threadChannels } = req.body;

    console.log('[BOT API] Tone Channels:', toneChannels);
    console.log('[BOT API] Thread Style Enabled:', threadStyle);
    console.log('[BOT API] Thread Channels:', threadChannels);

    await updateServerSettings(serverId, {
      toneEnabledChannels: toneChannels || [],
      threadStyleEnabled: threadStyle,
      threadStyleChannels: threadChannels || []
    });

    console.log('[BOT API] ✅ Advanced settings updated successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('[BOT API] ❌ Error updating advanced settings:', error);
    res.status(500).json({ error: 'Failed to update advanced settings' });
  }
});

// Update STT settings
router.post('/servers/:serverId/stt', async (req, res) => {
  try {
    const { serverId } = req.params;
    const { 
      enabled, 
      inputChannelId,
      outputChannelId,
      languages,
      flushIntervalMs
    } = req.body;

    const lang1 = languages && languages[0] ? languages[0] : null;
    const lang2 = languages && languages[1] ? languages[1] : null;
    const lang3 = languages && languages[2] ? languages[2] : null;

    const updateData = {
        enabled,
        inputChannelId,
        outputChannelId,
        flushIntervalMs: flushIntervalMs || 5000,
        language1: lang1,
        language2: lang2,
        language3: lang3,
        updatedBy: 'dashboard'
    };

    const sttSettings = await STTSettings.findOneAndUpdate(
      { guildId: serverId },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, sttSettings });
  } catch (error) {
    console.error('Error updating STT settings:', error);
    res.status(500).json({ error: 'Failed to update STT settings' });
  }
});

// Get feedback prompt state for current dashboard user
router.get('/feedback/config', verifySession, async (req, res) => {
  try {
    const userId = req.userSession?.user?.id;
    const [settings, submitted] = await Promise.all([
      getFeedbackSettings(),
      hasSubmittedFeedback(userId)
    ]);

    res.json({
      enabled: settings.feedbackCollectionEnabled !== false,
      hasSubmitted: !!submitted
    });
  } catch (error) {
    console.error('Error fetching feedback config:', error);
    res.status(500).json({ error: 'Failed to fetch feedback config' });
  }
});

// Submit feedback for current dashboard user (one submission per user)
router.post('/feedback/submit', verifySession, async (req, res) => {
  try {
    const settings = await getFeedbackSettings();
    if (settings.feedbackCollectionEnabled === false) {
      return res.status(403).json({ error: 'Feedback is currently disabled' });
    }

    const dashboardExperience = normalizeFeedbackValue(req.body?.dashboardExperience);
    const planType = normalizeFeedbackValue(req.body?.planType);
    const usageReason = normalizeFeedbackValue(req.body?.usageReason);
    const recommendScore = normalizeFeedbackValue(req.body?.recommendScore);
    const improvementSuggestion = sanitizeFeedbackText(req.body?.improvementSuggestion, 500);

    if (!FEEDBACK_OPTIONS.dashboardExperience.has(dashboardExperience)) {
      return res.status(400).json({ error: 'Invalid dashboardExperience value' });
    }
    if (!FEEDBACK_OPTIONS.planType.has(planType)) {
      return res.status(400).json({ error: 'Invalid planType value' });
    }
    if (!FEEDBACK_OPTIONS.usageReason.has(usageReason)) {
      return res.status(400).json({ error: 'Invalid usageReason value' });
    }
    if (!FEEDBACK_OPTIONS.recommendScore.has(recommendScore)) {
      return res.status(400).json({ error: 'Invalid recommendScore value' });
    }

    const user = req.userSession?.user || {};
    await createUserFeedback({
      userId: user.id,
      username: user.username || null,
      globalName: user.global_name || user.globalName || null,
      avatar: user.avatar || null,
      answers: {
        dashboardExperience,
        planType,
        usageReason,
        recommendScore,
        improvementSuggestion
      },
      meta: {
        locale: sanitizeFeedbackText(req.body?.locale, 64) || null,
        userAgent: sanitizeFeedbackText(req.headers['user-agent'], 255) || null
      }
    });

    res.json({ success: true });
  } catch (error) {
    if (
      error?.code === 'FEEDBACK_ALREADY_SUBMITTED' ||
      error?.message === 'FEEDBACK_ALREADY_SUBMITTED' ||
      error?.code === 11000
    ) {
      return res.status(409).json({ error: 'Feedback already submitted' });
    }

    console.error('Error saving feedback submission:', error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// Get personal buddy settings
router.get('/personalbuddy/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const settings = await getPersonalTranslationSettings(userId);

    res.json(settings || { enabled: false, targetLanguages: [] });
  } catch (error) {
    console.error('Error fetching personal buddy settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update personal buddy settings
router.post('/personalbuddy/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled, languages } = req.body;

    await togglePersonalTranslation(userId, enabled, languages);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating personal buddy:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get vote status
router.get('/vote/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    // Implement vote status check logic here
    // This should check Top.gg API or your vote tracking system

    res.json({
      hasVoted: false,
      nextVoteTime: null,
      totalVotes: 0,
      streak: 0,
      translationCount: 0
    });
  } catch (error) {
    console.error('Error fetching vote status:', error);
    res.status(500).json({ error: 'Failed to fetch vote status' });
  }
});

// Confirm vote from official site
router.post('/vote/confirm', async (req, res) => {
  try {
    const { userId, serverId } = req.body;

    if (!userId || !serverId) {
      return res.status(400).json({ error: 'Missing userId or serverId' });
    }

    console.log(`🗳️ Received website vote confirmation for user ${userId} on server ${serverId}`);

    // Fetch user info for the record
    let userDisplay = 'Web User';
    let userAvatar = null;
    let requester = { id: userId, displayName: userDisplay };

    if (router.botClient) {
      try {
        const user = await router.botClient.users.fetch(userId);
        if (user) {
          userDisplay = user.username;
          userAvatar = user.displayAvatarURL();
          requester = {
             id: userId, 
             username: user.username, 
             displayName: user.username,
             displayAvatarURL: () => user.displayAvatarURL()
          };
        }
      } catch (e) {
        console.warn('Could not fetch user info for vote:', e.message);
      }
    }

    const result = await monetizationService.handleVoteReward(userId, serverId, 20, requester, 'topgg');

    if (result.success) {
      // Send notification to the server if possible
      if (router.botClient) {
        try {
          const guild = await router.botClient.guilds.fetch(serverId);
          if (guild) {
            const successEmbed = new EmbedBuilder()
                .setColor('#00ff88')
                .setTitle('🎉 Free Credits Added!')
              .setDescription(`**35 free translations** have been added to this server.\n\nThanks to **${userDisplay}** for supporting AirTranslator!`)
                .setFooter({ text: 'Air Translator • Vote rewards', iconURL: router.botClient.user.displayAvatarURL() })
                .setTimestamp(new Date());

            // 1. Try System Channel
            let channel = guild.systemChannel;
            
            // 2. Fallback to any text channel where bot has perms
            if (!channel || !channel.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
                channel = guild.channels.cache.find(ch => 
                    ch.type === 0 && // Text Channel
                    ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])
                );
            }

            if (channel) {
                await channel.send({ embeds: [successEmbed] });
                console.log(`✅ Sent vote confirmation to channel ${channel.name} in server ${guild.name}`);
            } else {
                console.warn(`⚠️ Could not find suitable channel to send vote confirmation in server ${guild.name}`);
            }
          }
        } catch (e) {
            console.error('Failed to send vote confirmation to discord:', e);
        }
      }
      return res.json(result);
    } else {
        return res.status(400).json(result);
    }

  } catch (error) {
    console.error('Error confirming vote:', error);
    res.status(500).json({ error: 'Failed to confirm vote' });
  }
});

module.exports = router;
