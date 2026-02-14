const { EmbedBuilder } = require('discord.js');
const nodeCron = require('node-cron');

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
 * @returns {Object} Result object with success status and delivery results
 */
async function sendServerMessage(messageData) {
    const client = global.discordClient;
    
    if (!client) {
        return { success: false, message: 'Bot not ready' };
    }
    
    const { target, serverId, title, content, color, includeFooter, urgentMessage } = messageData;
    
    if (!content) {
        return { success: false, message: 'Message content is required' };
    }
    
    const embed = new EmbedBuilder()
        .setDescription(content)
        .setColor(color || '#3498db')
        .setTimestamp();
    
    if (title) {
        embed.setTitle(title);
    }
    
    if (includeFooter) {
        embed.setFooter({ text: 'AirTranslator Bot' });
    }
    
    if (urgentMessage) {
        embed.addFields({ name: '⚠️ Priority', value: 'Important Message', inline: true });
    }
    
    let targetGuilds = [];
    
    if (target === 'all') {
        targetGuilds = Array.from(client.guilds.cache.values());
    } else if (target === 'specific' && serverId) {
        const guild = client.guilds.cache.get(serverId);
        if (guild) {
            targetGuilds = [guild];
        }
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
                await channel.send({ embeds: [embed] });
                results.sent++;
                results.details.push({ 
                    serverId: guild.id, 
                    serverName: guild.name, 
                    status: 'sent', 
                    channelName: channel.name 
                });
            } else {
                results.failed++;
                results.details.push({ 
                    serverId: guild.id, 
                    serverName: guild.name, 
                    status: 'failed', 
                    reason: 'No suitable channel found' 
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
 * Handle send message endpoint
 */
async function handleSendMessage(req, res) {
    try {
        const postData = await parsePostData(req);
        const messageData = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        const result = await sendServerMessage(messageData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    } catch (error) {
        console.error('Message sending error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

/**
 * Schedules a message to be sent at specific times
 */
function scheduleMessage(messageConfig) {
    const { schedule, time, timezone, customSchedule, target, content, title, color } = messageConfig;
    
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
        await sendServerMessage({ target, content, title, color });
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

module.exports = {
    handleSendMessage,
    handleScheduleMessage,
    getScheduledMessages,
    handleCancelScheduled,
    handleAutoSetup
};
