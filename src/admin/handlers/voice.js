/**
 * Voice Call Translation & Speech-to-Text handler
 * Provides API endpoints for the Voice Calls monitoring tab in the admin dashboard.
 */
const VoiceCallTranslation = require('../../models/VoiceCallTranslation');
const STTSettings = require('../../models/STTSettings');
const Server = require('../../models/Server');
const voiceCallTranslationService = require('../../services/voiceCallTranslationService');

function getTodayUTC() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Get aggregated voice stats
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function getVoiceStats(req, res) {
    try {
        const [vctEnabled, activeSessions, sttEnabled, allVct, allStt] = await Promise.all([
            VoiceCallTranslation.countDocuments({ enabled: true }),
            voiceCallTranslationService.getActiveCount(),
            STTSettings.countDocuments({ enabled: true }),
            VoiceCallTranslation.find({}).lean(),
            STTSettings.find({}).lean()
        ]);

        // Combine unique guild IDs for total voice-enabled servers
        const vctGuilds = new Set(allVct.filter(v => v.enabled).map(v => v.guildId));
        const sttGuilds = new Set(allStt.filter(s => s.enabled).map(s => s.guildId));
        const totalVoiceServers = new Set([...vctGuilds, ...sttGuilds]).size;

        // Model distribution
        const modelDistribution = {};
        allVct.forEach(v => {
            const m = v.model || 'unknown';
            modelDistribution[m] = (modelDistribution[m] || 0) + 1;
        });

        // Source / target language distribution
        const sourceLangs = {};
        const targetLangs = {};
        allVct.forEach(v => {
            if (v.sourceLanguage && v.sourceLanguage !== 'auto') {
                sourceLangs[v.sourceLanguage] = (sourceLangs[v.sourceLanguage] || 0) + 1;
            }
            if (v.targetLanguage) {
                targetLangs[v.targetLanguage] = (targetLangs[v.targetLanguage] || 0) + 1;
            }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            vctEnabled,
            activeSessions,
            sttEnabled,
            totalVoiceServers,
            modelDistribution,
            sourceLangs,
            targetLangs,
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error('Error getting voice stats:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
    }
}

/**
 * Get VCT server list with live status enrichment
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function getVctServers(req, res) {
    try {
        const client = global.discordClient;
        const vctRecords = await VoiceCallTranslation.find({}).sort({ updatedAt: -1 }).lean();

        const guildIds = vctRecords.map(r => r.guildId);
        const serverDocs = await Server.find({ serverId: { $in: guildIds } }).lean();
        const serverMap = new Map(serverDocs.map(s => [s.serverId, s]));

        const today = getTodayUTC();

        const enriched = vctRecords.map(record => {
            const guild = client ? client.guilds.cache.get(record.guildId) : null;
            const liveStatus = voiceCallTranslationService.getTranslationStatus(record.guildId);
            const serverDoc = serverMap.get(record.guildId);
            const isPremium = serverDoc?.monetization?.isExempt === true;

            const dailyMinutesUsed = record.dailyUsageDate === today ? (record.dailyMinutesUsed || 0) : 0;
            const dailyRemaining = isPremium ? null : Math.max(0, 60 - dailyMinutesUsed);

            return {
                guildId: record.guildId,
                serverName: guild ? guild.name : 'Unknown Server',
                voiceChannelId: record.voiceChannelId,
                voiceChannelName: record.voiceChannelId && guild
                    ? (guild.channels.cache.get(record.voiceChannelId)?.name || record.voiceChannelId)
                    : record.voiceChannelId,
                enabled: record.enabled,
                isActive: liveStatus.active || record.isActive || false,
                sourceLanguage: record.sourceLanguage || 'auto',
                targetLanguage: record.targetLanguage || '—',
                model: record.model || 'unknown',
                voice: record.voice || '—',
                isPremium,
                dailyMinutesUsed,
                dailyRemaining,
                lastStartedAt: record.lastStartedAt,
                lastStoppedAt: record.lastStoppedAt,
                updatedAt: record.updatedAt
            };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ servers: enriched, total: enriched.length }));
    } catch (error) {
        console.error('Error getting VCT servers:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
    }
}

/**
 * Get STT server list
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function getSttServers(req, res) {
    try {
        const client = global.discordClient;
        const sttRecords = await STTSettings.find({}).sort({ updatedAt: -1 }).lean();

        const enriched = sttRecords.map(record => {
            const guild = client ? client.guilds.cache.get(record.guildId) : null;

            return {
                guildId: record.guildId,
                serverName: guild ? guild.name : 'Unknown Server',
                enabled: record.enabled,
                inputChannelId: record.inputChannelId,
                inputChannelName: record.inputChannelId && guild
                    ? (guild.channels.cache.get(record.inputChannelId)?.name || record.inputChannelId)
                    : record.inputChannelId,
                outputChannelId: record.outputChannelId,
                outputChannelName: record.outputChannelId && guild
                    ? (guild.channels.cache.get(record.outputChannelId)?.name || record.outputChannelId)
                    : record.outputChannelId,
                model: record.model || 'voxtral-mini-latest',
                language1: record.language1 || null,
                language2: record.language2 || null,
                language3: record.language3 || null,
                updatedAt: record.updatedAt
            };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ servers: enriched, total: enriched.length }));
    } catch (error) {
        console.error('Error getting STT servers:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
    }
}

module.exports = {
    getVoiceStats,
    getVctServers,
    getSttServers
};
