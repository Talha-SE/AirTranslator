const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const nodeCron = require('node-cron');
const monetizationService = require('../../services/monetizationService');
const { CAMPAIGN_TRIGGER_COUNT } = require('../../services/unlimitedUsageCampaignService');

// Store original broadcast message content for translation feature
// Key: messageId, Value: { title, content, guildId, timestamp }
if (!global.broadcastMessages) global.broadcastMessages = new Map();

// Scheduled messages storage
const scheduledMessages = new Map(); // job metadata only (JSON-safe)
const scheduledJobs = new Map(); // jobId -> cron job handle
const MAX_SCHEDULED_MESSAGES = 1000;
const SESSION_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10m

/**
 * Sweep scheduled messages to control memory
 */
function sweepScheduledMessages() {
    while (scheduledMessages.size > MAX_SCHEDULED_MESSAGES) {
        const oldestKey = scheduledMessages.keys().next().value;
        const job = scheduledJobs.get(oldestKey);
        if (job && typeof job.destroy === 'function') {
            try { job.destroy(); } catch (_) {}
        }
        scheduledJobs.delete(oldestKey);
        scheduledMessages.delete(oldestKey);
    }
}

// Periodic sweeping
setInterval(sweepScheduledMessages, SESSION_SWEEP_INTERVAL_MS).unref();

/**
 * Parses the POST data from the request.
 * @param {http.IncomingMessage} req - The HTTP request object.
 * @returns {Promise<Object>} A promise that resolves to the parsed data object.
 */
function parsePostData(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    const data = {};
                    for (const [key, value] of params) {
                        data[key] = value;
                    }
                    resolve(data);
                } else {
                    resolve({ body });
                }
            } catch {
                resolve({ body });
            }
        });
    });
}

/**
 * Sends messages to Discord servers
 * @param {Object} messageData - Message configuration data
 * @param {Function} onProgress - Optional callback for progress updates (called with { serverName, status, result? })
 * @returns {Object} Result object with success status and delivery results
 */
async function sendServerMessage(messageData, onProgress) {
    const client = global.discordClient;
    
    if (!client) {
        return { success: false, message: 'Bot not ready' };
    }
    
    const {
        target,
        serverId,
        selectedServerIds,
        title,
        content,
        color,
        includeFooter,
        urgentMessage,
        sendAsText,
        sendAsV2Container,
        imageUrl
    } = messageData;
    
    if (!content) {
        return { success: false, message: 'Message content is required' };
    }
    
    let messagePayload = {};

    if (sendAsText) {
        let textParts = [];
        if (urgentMessage) textParts.push('⚠️ **IMPORTANT**');
        if (title) textParts.push(`**${title}**`);
        textParts.push(content);
        if (includeFooter) textParts.push(`\n_Sent via AirTranslator Bot_`);
        
        messagePayload = { content: textParts.join('\n\n') };
    } else if (sendAsV2Container) {
        // Build Discord Components V2 Container (flags: 32768)
        const innerComponents = [];

        // Add image before title if provided
        if (imageUrl) {
            innerComponents.push({
                type: 12, // MediaGallery
                items: [{
                    media: { url: imageUrl },
                    description: 'Broadcast image'
                }]
            });
        }

        if (title) {
            innerComponents.push({ type: 10, content: `**${title}**` });
        }
        innerComponents.push({ type: 10, content: content });
        if (includeFooter) {
            innerComponents.push({ type: 10, content: `_Sent via AirTranslator Bot_` });
        }
        if (urgentMessage) {
            innerComponents.push({ type: 10, content: '⚠️ **Important Message**' });
        }

        messagePayload = {
            flags: 32768, // IS_COMPONENTS_V2
            components: [{
                type: 17, // Container
                components: innerComponents
            }]
        };
    } else {
        const embed = new EmbedBuilder()
            .setDescription(content)
            .setColor(color || '#3498db');
        
        if (title) {
            embed.setTitle(title);
        }
        
        if (includeFooter) {
            embed.setFooter({ text: 'AirTranslator Bot' });
        }
        
        if (urgentMessage) {
            embed.addFields({ name: '⚠️ Priority', value: 'Important Message', inline: true });
        }
        
        // Add image before title if provided
        if (imageUrl) {
            embed.setImage(imageUrl);
        }
        
        messagePayload = { embeds: [embed] };
    }

    // Add Translate button (only for card/container messages, not plain text)
    if (!sendAsText) {
        const translateRow = { type: 1, components: [{
            type: 2,
            custom_id: 'translate_broadcast',
            label: 'Translate',
            emoji: { name: '✨' },
            style: 2 // Secondary
        }]};

        if (messagePayload.flags === 32768 && messagePayload.components?.[0]) {
            // V2 Container — add button inside the Container
            messagePayload.components[0].components.push(translateRow);
        } else if (messagePayload.embeds) {
            // Embed — add button as separate ActionRow
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle: BS } = require('discord.js');
            messagePayload.components = [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('translate_broadcast')
                    .setLabel('Translate')
                    .setEmoji('✨')
                    .setStyle(BS.Secondary)
            )];
        }
    }
    
    let targetGuilds = [];
    
    if (target === 'all') {
        targetGuilds = Array.from(client.guilds.cache.values());
    } else if (target === 'specific' && serverId) {
        const guild = client.guilds.cache.get(serverId);
        if (guild) {
            targetGuilds = [guild];
        }
    } else if (target === 'selected') {
        const serverIds = Array.isArray(selectedServerIds)
            ? [...new Set(selectedServerIds.map((id) => String(id || '').trim()).filter(Boolean))]
            : [];

        targetGuilds = serverIds
            .map((id) => client.guilds.cache.get(id))
            .filter(Boolean);
    } else if (target === 'large') {
        targetGuilds = Array.from(client.guilds.cache.values()).filter(g => g.memberCount >= 1000);
    } else if (target === 'active') {
        // For now, just send to all servers; enhance this logic later
        targetGuilds = Array.from(client.guilds.cache.values());
    }
    
    const results = {
        success: true,
        total: targetGuilds.length,
        sent: 0,
        failed: 0,
        details: []
    };
    
    for (const guild of targetGuilds) {
        if (onProgress) {
            onProgress({ type: 'start', serverName: guild.name });
        }
        
        try {
            // Find a suitable channel to send the message
            let channel = guild.systemChannel;
            
            if (!channel || !channel.permissionsFor(client.user)?.has(['SendMessages', 'EmbedLinks'])) {
                channel = guild.channels.cache.find(ch => 
                    ch.type === 0 && 
                    ch.permissionsFor(client.user)?.has(['SendMessages', 'EmbedLinks']) &&
                    (ch.name.includes('general') || ch.name.includes('chat') || ch.name.includes('announce'))
                );
            }
            
            if (!channel) {
                channel = guild.channels.cache.find(ch => 
                    ch.type === 0 && 
                    ch.permissionsFor(client.user)?.has(['SendMessages', 'EmbedLinks'])
                );
            }
            
            if (channel) {
                const sentMessage = await channel.send(messagePayload);
                
                // Store original content for translation feature
                if (!sendAsText && sentMessage && sentMessage.id) {
                    global.broadcastMessages.set(sentMessage.id, {
                        title: title || null,
                        content: content,
                        guildId: guild.id,
                        imageUrl: imageUrl || null,
                        timestamp: Date.now()
                    });
                    
                    // Auto-cleanup after 24 hours
                    setTimeout(() => {
                        global.broadcastMessages.delete(sentMessage.id);
                    }, 24 * 60 * 60 * 1000);
                }
                
                results.sent++;
                const detail = { 
                    serverId: guild.id, 
                    serverName: guild.name, 
                    status: 'sent', 
                    channelName: channel.name 
                };
                results.details.push(detail);
                
                if (onProgress) {
                    onProgress({ type: 'finish', serverName: guild.name, status: 'sent', detail });
                }
            } else {
                results.failed++;
                const detail = { 
                    serverId: guild.id, 
                    serverName: guild.name, 
                    status: 'failed', 
                    reason: 'No suitable channel found' 
                };
                results.details.push(detail);
                
                if (onProgress) {
                    onProgress({ type: 'finish', serverName: guild.name, status: 'failed', detail });
                }
            }
        } catch (error) {
            results.failed++;
            const detail = { 
                serverId: guild.id, 
                serverName: guild.name, 
                status: 'failed', 
                reason: error.message 
            };
            results.details.push(detail);
            
            if (onProgress) {
                onProgress({ type: 'finish', serverName: guild.name, status: 'failed', detail });
            }
        }
    }
    
    return results;
}

/**
 * Handle send message endpoint
 */
async function handleSendMessage(req, res) {
    try {
        const postData = await parsePostData(req);
        const messageData = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        // Set headers for SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        
        const result = await sendServerMessage(messageData, (progressEvent) => {
            // Stream progress updates
            res.write(`data: ${JSON.stringify(progressEvent)}\n\n`);
        });
        
        // Send final result
        res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Error sending message:', error);
        // If headers not sent, send JSON error. If sent, stream error.
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: error.message }));
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
            res.end();
        }
    }
}

/**
 * Schedules a message to be sent at specific times
 */
function scheduleMessage(messageConfig) {
    const {
        schedule,
        time,
        timezone,
        customSchedule,
        target,
        serverId,
        selectedServerIds,
        content,
        title,
        color,
        includeFooter,
        urgentMessage,
        sendAsText
    } = messageConfig;
    
    let cronSchedule = customSchedule;
    
    if (schedule === 'daily') {
        const [hour, minute] = (time || '12:00').split(':');
        cronSchedule = `${minute} ${hour} * * *`;
    } else if (schedule === 'weekly') {
        const [hour, minute] = (time || '12:00').split(':');
        cronSchedule = `${minute} ${hour} * * 1`; // Every Monday
    } else if (schedule === 'monthly') {
        const [hour, minute] = (time || '12:00').split(':');
        cronSchedule = `${minute} ${hour} 1 * *`; // First day of month
    }
    
    const jobId = `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job = nodeCron.schedule(cronSchedule, async () => {
        await sendServerMessage({
            target,
            serverId,
            selectedServerIds,
            content,
            title,
            color,
            includeFooter,
            urgentMessage,
            sendAsText
        });
    }, {
        timezone: timezone || 'UTC'
    });
    
    scheduledMessages.set(jobId, {
        schedule: cronSchedule,
        timezone: timezone || 'UTC',
        messageConfig
    });
    scheduledJobs.set(jobId, job);
    
    return jobId;
}

/**
 * Handle schedule message endpoint
 */
async function handleScheduleMessage(req, res) {
    try {
        const postData = await parsePostData(req);
        const messageData = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        const jobId = scheduleMessage(messageData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, jobId }));
    } catch (error) {
        console.error('Message scheduling error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

/**
 * Get scheduled messages
 */
function getScheduledMessages(req, res) {
    const messages = Array.from(scheduledMessages.entries()).map(([id, config]) => ({
        id,
        ...config
    }));
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, messages }));
}

/**
 * Cancel a scheduled message
 */
function cancelScheduledMessage(jobId) {
    const job = scheduledJobs.get(jobId);
    if (job && typeof job.stop === 'function') {
        job.stop();
    }
    scheduledJobs.delete(jobId);
    scheduledMessages.delete(jobId);
}

/**
 * Handle cancel scheduled message endpoint
 */
function handleCancelScheduled(req, res, jobId) {
    cancelScheduledMessage(jobId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
}

/**
 * Send auto setup packet to servers
 */
async function sendAutoSetupPacket({ serverId = null, sendAll = false }) {
    const client = global.discordClient;
    
    if (!client) {
        return { success: false, message: 'Bot not ready' };
    }
    
    const autoSetupEmbed = new EmbedBuilder()
        .setColor('#6C8BFF')
        .setTitle('🚀 Quick Setup Guide for AirTranslator')
        .setDescription('Get started with AirTranslator in just a few simple steps!')
        .addFields(
            { name: '1️⃣ Quick Setup', value: 'Run `/quicksetup` to automatically create translation channels', inline: false },
            { name: '2️⃣ Add Channels', value: 'Use `/addchannel` to add custom channels for translation', inline: false },
            { name: '3️⃣ View Setup', value: 'Check your configuration with `/listsetups`', inline: false }
        )
        .setFooter({ text: 'Need help? Use /help for more commands' })
        .setTimestamp();
    
    let targetGuilds = [];
    
    if (sendAll) {
        targetGuilds = Array.from(client.guilds.cache.values());
    } else if (serverId) {
        const guild = client.guilds.cache.get(serverId);
        if (guild) {
            targetGuilds = [guild];
        } else {
            return { success: false, message: 'Server not found' };
        }
    } else {
        return { success: false, message: 'Must specify serverId or sendAll' };
    }
    
    const results = {
        success: true,
        total: targetGuilds.length,
        sent: 0,
        failed: 0,
        details: []
    };
    
    for (const guild of targetGuilds) {
        try {
            let channel = guild.systemChannel;
            
            if (!channel || !channel.permissionsFor(client.user)?.has(['SendMessages', 'EmbedLinks'])) {
                channel = guild.channels.cache.find(ch => 
                    ch.type === 0 && 
                    ch.permissionsFor(client.user)?.has(['SendMessages', 'EmbedLinks']) &&
                    (ch.name.includes('general') || ch.name.includes('chat'))
                );
            }
            
            if (!channel) {
                channel = guild.channels.cache.find(ch => 
                    ch.type === 0 && 
                    ch.permissionsFor(client.user)?.has(['SendMessages', 'EmbedLinks'])
                );
            }
            
            if (channel) {
                await channel.send({ embeds: [autoSetupEmbed] });
                results.sent++;
                results.details.push({ 
                    serverId: guild.id, 
                    serverName: guild.name, 
                    status: 'sent' 
                });
            } else {
                results.failed++;
                results.details.push({ 
                    serverId: guild.id, 
                    serverName: guild.name, 
                    status: 'failed', 
                    reason: 'No suitable channel' 
                });
            }
        } catch (error) {
            results.failed++;
            results.details.push({ 
                serverId: guild.id, 
                serverName: guild.name, 
                status: 'failed', 
                reason: error.message 
            });
        }
    }
    
    return results;
}

/**
 * Handle auto setup endpoint
 */
async function handleAutoSetup(req, res) {
    try {
        const postData = await parsePostData(req);
        const payload = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        const result = await sendAutoSetupPacket({
            serverId: payload.serverId,
            sendAll: Boolean(payload.sendAll)
        });
        
        const statusCode = result.success ? 200 : 400;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    } catch (error) {
        console.error('Auto setup send error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

/**
 * Get auto campaign settings for messaging tab
 */
async function getCampaignSettings(req, res) {
    try {
        await monetizationService.ensureSettingsLoaded();
        const settings = monetizationService.getSettings();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            autoUnlimitedUsageCampaignEnabled: Boolean(settings.autoUnlimitedUsageCampaignEnabled),
            triggerCount: CAMPAIGN_TRIGGER_COUNT
        }));
    } catch (error) {
        console.error('Error getting campaign settings:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

/**
 * Update auto campaign settings for messaging tab
 */
async function updateCampaignSettings(req, res) {
    try {
        const postData = await parsePostData(req);
        const payload = typeof postData === 'string' ? JSON.parse(postData) : postData;

        const rawEnabled = payload?.autoUnlimitedUsageCampaignEnabled;
        const enabled = typeof rawEnabled === 'string'
            ? rawEnabled.toLowerCase() === 'true'
            : Boolean(rawEnabled);

        await monetizationService.updateGlobalSettings({
            autoUnlimitedUsageCampaignEnabled: enabled
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            autoUnlimitedUsageCampaignEnabled: enabled,
            triggerCount: CAMPAIGN_TRIGGER_COUNT
        }));
    } catch (error) {
        console.error('Error updating campaign settings:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

module.exports = {
    handleSendMessage,
    handleScheduleMessage,
    getScheduledMessages,
    handleCancelScheduled,
    handleAutoSetup,
    getCampaignSettings,
    updateCampaignSettings
};
