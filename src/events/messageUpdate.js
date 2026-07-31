/**
 * Message Update Event Handler
 * 
 * When a user edits their original message, this handler:
 * 1. Finds the bot's translation reply to that message
 * 2. Re-translates the edited content
 * 3. Updates the bot's translation message in place
 */

const { getSetupsByChannelId, getToneSettings } = require('../services/databaseService');
const { translateTextToMultipleLanguages, detectLanguage } = require('../services/mistralService');
const monetizationService = require('../services/monetizationService');
const translationQueueService = require('../services/translationQueueService');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const { buildAutoTranslationContainer, buildAutoTranslationButtons } = require('../utils/translationCardBuilder');
const {
    getLanguageDisplayName: getMappedLanguageDisplayName,
    getLanguageFlag: getMappedLanguageFlag
} = require('../utils/flagMapping');

function buildDashboardUrl() {
    return process.env.DASHBOARD_URL || 'https://airtranslator.app';
}

function getLanguageDisplayName(language) {
    return getMappedLanguageDisplayName(language);
}

function getLanguageFlag(langCode) {
    return getMappedLanguageFlag(langCode);
}

/**
 * Find the bot's reply to a specific message
 * Searches recent messages in the channel for bot replies
 */
async function findBotReply(message) {
    try {
        // Fetch recent messages around the original message
        const messages = await message.channel.messages.fetch({
            around: message.id,
            limit: 25
        });

        console.log(`📝 [messageUpdate] Fetched ${messages.size} messages, looking for bot reply to ${message.id}`);

        // Sort messages by createdTimestamp to find ordering
        const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const originalIdx = sorted.findIndex(m => m.id === message.id);

        console.log(`📝 [messageUpdate] Original message at index ${originalIdx} of ${sorted.length}`);

        // Strategy 1: Find bot messages that reply to this message via message_reference
        const byRef = messages.find(m =>
            m.author.bot &&
            m.author.id === message.client.user.id &&
            m.message_reference &&
            m.message_reference.message_id === message.id
        );
        if (byRef) {
            console.log(`📝 [messageUpdate] Found reply via message_reference: ${byRef.id}`);
            return byRef;
        }

        // Strategy 2: Find bot messages that have referenced_message matching our message
        const byReferenced = messages.find(m =>
            m.author.bot &&
            m.author.id === message.client.user.id &&
            m.referenced_message &&
            m.referenced_message.id === message.id
        );
        if (byReferenced) {
            console.log(`📝 [messageUpdate] Found reply via referenced_message: ${byReferenced.id}`);
            return byReferenced;
        }

        // Strategy 3: The bot's reply is typically the NEXT bot message after the original
        // Look for the first bot message that comes right after the original message
        if (originalIdx >= 0) {
            for (let i = originalIdx + 1; i < sorted.length; i++) {
                const candidate = sorted[i];
                if (candidate.author.bot && candidate.author.id === message.client.user.id) {
                    // Check if this bot message is a direct reply (within 30 seconds of original)
                    const timeDiff = candidate.createdTimestamp - message.createdTimestamp;
                    if (timeDiff < 30000) { // Within 30 seconds
                        console.log(`📝 [messageUpdate] Found reply via proximity: ${candidate.id} (${timeDiff}ms after original)`);
                        return candidate;
                    }
                }
            }
        }

        console.log(`📝 [messageUpdate] No bot reply found after checking all strategies`);
        return null;
    } catch (error) {
        console.error('Error finding bot reply:', error?.message);
        return null;
    }
}

module.exports = async (client, message) => {
    // DEBUG: Log every messageUpdate event to confirm it fires
    console.log(`📝 [messageUpdate] Event fired for: "${message.content?.substring(0, 50)}" by ${message.author?.tag} in #${message.channel?.name}`);

    // Skip bots, empty messages, DMs
    if (message.author.bot) { console.log(`📝 [messageUpdate] SKIP: bot message`); return; }
    if (!message.content || !message.content.trim()) { console.log(`📝 [messageUpdate] SKIP: empty content`); return; }
    if (!message.guild) { console.log(`📝 [messageUpdate] SKIP: DM message`); return; }

    try {
        // Check if server can translate (monetization check)
        const canTranslate = await monetizationService.canTranslate(message.guild.id);
        if (!canTranslate) { console.log(`📝 [messageUpdate] SKIP: monetization limit reached`); return; }

        // Check if this channel has translation setup
        const Server = require('../models/Server');
        const server = await Server.findOne({ serverId: message.guild.id });

        let languages = [];

        // Check server-wide translation
        if (server?.serverWideTranslation) {
            // Skip if channel is excluded
            if (server.serverWideExcludedChannels.includes(message.channel.id)) {
                console.log(`📝 [messageUpdate] SKIP: channel excluded from server-wide`);
                return;
            }

            languages = [...new Set(
                server.setups.flatMap(setup =>
                    setup.languages.map(lang => lang.toLowerCase())
                )
            )];
            console.log(`📝 [messageUpdate] Server-wide languages: ${JSON.stringify(languages)}`);
        }

        // Fall back to channel-specific setups
        if (languages.length === 0) {
            const matchingSetups = await getSetupsByChannelId(message.guild.id, message.channel.id);
            if (!matchingSetups || matchingSetups.length === 0) { console.log(`📝 [messageUpdate] SKIP: no matching setups for channel`); return; }

            languages = [...new Set(
                matchingSetups.flatMap(setup =>
                    setup.languages.map(lang => lang.toLowerCase())
                )
            )];
            console.log(`📝 [messageUpdate] Channel-specific languages: ${JSON.stringify(languages)}`);
        }

        if (languages.length === 0) { console.log(`📝 [messageUpdate] SKIP: no languages found`); return; }

        // Find the bot's existing reply to this message
        const botReply = await findBotReply(message);
        if (!botReply) { console.log(`📝 [messageUpdate] SKIP: no bot reply found for message ${message.id}`); return; }

        console.log(`📝 Message edited in #${message.channel.name} (${message.guild.name}) — updating translation`);

        // Detect language of edited content
        const detectedLanguage = await detectLanguage(message.content);
        console.log(`📝 Re-detecting language: ${detectedLanguage}`);

        // Filter out source language from targets
        const targetLanguagesArray = languages.filter(language =>
            language !== AUTO_DETECT_LANGUAGE &&
            language.toLowerCase() !== detectedLanguage.toLowerCase()
        );

        if (targetLanguagesArray.length === 0) {
            // Source language matches target — edit to show "same language" message
            try {
                await botReply.edit({
                    content: `⚠️ *The edited message is in the same language as the translation target.*`,
                    embeds: [],
                    components: []
                });
            } catch (e) {
                console.error('Error editing bot reply (same language):', e?.message);
            }
            return;
        }

        // Translate the edited content
        const toneSettings = await getToneSettings(message.guild.id, message.channel.id);
        const { keys: activeApiKeys, keyIndex, totalKeys } = translationQueueService.getNextApiKey();

        let translations = {};
        for (let i = 0; i < activeApiKeys.length; i++) {
            const apiKey = activeApiKeys[i];
            try {
                translations = await translateTextToMultipleLanguages(
                    message.content,
                    targetLanguagesArray,
                    detectedLanguage,
                    toneSettings,
                    apiKey
                );
                break;
            } catch (error) {
                const isLastKey = i === activeApiKeys.length - 1;
                if (isLastKey) {
                    console.error(`❌ [MessageUpdate] All API keys failed:`, error?.message);
                    return;
                }
            }
        }

        // Build new translation entries
        const translationEntries = Object.entries(translations).filter(([, t]) => typeof t === 'string' && t.length > 0);
        if (translationEntries.length === 0) return;

        // Check for long translations
        const longTranslations = [];
        const containerTranslations = translationEntries.map(([language, translation]) => {
            const flag = getLanguageFlag(language);
            const displayLanguage = getLanguageDisplayName(language);

            let displayTranslation = translation;
            const TEXT_LIMIT = 1024;
            if (translation.length > TEXT_LIMIT) {
                longTranslations.push({ language, displayLanguage, translation });
                const previewLen = 300;
                displayTranslation = translation.substring(0, previewLen) + '...\n\n— View full translation below —';
            }

            return { flag, displayLanguage, translation: displayTranslation };
        });

        // Check if server is exempt
        let isServerExempt = false;
        try {
            const serverStats = await monetizationService.getServerStats(message.guild.id);
            isServerExempt = Boolean(serverStats?.isExempt);
        } catch (e) { /* continue */ }

        // Build buttons
        let containerButtons = null;
        if (!isServerExempt) {
            containerButtons = buildAutoTranslationButtons({
                guildId: message.guild.id,
                isServerExempt,
                dashboardUrl: buildDashboardUrl(),
            });
        }

        // Build the new Components V2 Container
        const containerPayload = buildAutoTranslationContainer({
            translations: containerTranslations,
            authorName: message.author.displayName,
            detectedLanguage,
            isLastChunk: true,
            buttons: containerButtons,
        });

        // Edit the bot's reply with updated translation
        try {
            await botReply.edit({
                ...containerPayload,
                allowedMentions: { repliedUser: false }
            });
            console.log(`✅ Updated translation for edited message in #${message.channel.name}`);
        } catch (editError) {
            console.error('Error editing bot reply:', editError?.message);
        }

    } catch (error) {
        console.error('Error in messageUpdate handler:', error?.message);
    }
};
