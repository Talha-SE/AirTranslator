const { getSetupsByChannelId, getToneSettings, updateServerConfig, shouldUseThreadTranslation, getServerSetups } = require('../services/databaseService');
const { getPersonalTranslationSettings, recordPersonalTranslation } = require('../services/databaseService');
const { translateText, detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const monetizationService = require('../services/monetizationService');
const fastq = require('fastq');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');
const translationQueueService = require('../services/translationQueueService');
const { maybeSendUnlimitedUsageOffer } = require('../services/unlimitedUsageCampaignService');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Server = require('../models/Server');
const {
    getLanguageDisplayName: getMappedLanguageDisplayName,
    getLanguageFlag: getMappedLanguageFlag
} = require('../utils/flagMapping');

// Split text into Discord-safe chunks (<= 2000 chars),
// preferring to break on newlines or spaces near the limit
function splitIntoDiscordChunks(text, maxLen = 1990) {
    if (!text || text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let idx = remaining.lastIndexOf('\n', maxLen);
        if (idx === -1 || idx < maxLen * 0.5) {
            idx = remaining.lastIndexOf(' ', maxLen);
        }
        if (idx === -1 || idx < maxLen * 0.5) idx = maxLen; // hard split fallback
        chunks.push(remaining.slice(0, idx).trimEnd());
        remaining = remaining.slice(idx).trimStart();
    }
    if (remaining.length) chunks.push(remaining);
    return chunks;
}

// Helper function to format language names for display
function getLanguageDisplayName(language) {
    return getMappedLanguageDisplayName(language);
}

// Helper function to get language flag emoji
function getLanguageFlag(langCode) {
    return getMappedLanguageFlag(langCode);
    const lang = langCode.toLowerCase();
    
    // Map of language codes and full names to flags
    const flags = {
        'en': '🇬🇧', 'english': '🇬🇧',
        'es': '🇪🇸', 'spanish': '🇪🇸',
        'fr': '🇫🇷', 'french': '🇫🇷',
        'de': '🇩🇪', 'german': '🇩🇪',
        'it': '🇮🇹', 'italian': '🇮🇹',
        'pt': '🇵🇹', 'portuguese': '🇵🇹',
        'ja': '🇯🇵', 'japanese': '🇯🇵',
        'ko': '🇰🇷', 'korean': '🇰🇷',
        'zh': '🇨🇳', 'chinese': '🇨🇳', 'chinese (simplified)': '🇨🇳', 'chinese (traditional)': '🇹🇼',
        'ru': '🇷🇺', 'russian': '🇷🇺',
        'ar': '🇸🇦', 'arabic': '🇸🇦',
        'hi': '🇮🇳', 'hindi': '🇮🇳',
        'tr': '🇹🇷', 'turkish': '🇹🇷',
        'nl': '🇳🇱', 'dutch': '🇳🇱',
        'pl': '🇵🇱', 'polish': '🇵🇱',
        'sv': '🇸🇪', 'swedish': '🇸🇪',
        'fi': '🇫🇮', 'finnish': '🇫🇮',
        'no': '🇳🇴', 'norwegian': '🇳🇴',
        'da': '🇩🇰', 'danish': '🇩🇰',
        'cs': '🇨🇿', 'czech': '🇨🇿',
        'el': '🇬🇷', 'greek': '🇬🇷',
        'he': '🇮🇱', 'hebrew': '🇮🇱',
        'th': '🇹🇭', 'thai': '🇹🇭',
        'vi': '🇻🇳', 'vietnamese': '🇻🇳',
        'id': '🇮🇩', 'indonesian': '🇮🇩',
        'ms': '🇲🇾', 'malay': '🇲🇾',
        'fil': '🇵🇭', 'filipino': '🇵🇭', 'tagalog': '🇵🇭',
        'uk': '🇺🇦', 'ukrainian': '🇺🇦',
        'ro': '🇷🇴', 'romanian': '🇷🇴',
        'hu': '🇭🇺', 'hungarian': '🇭🇺',
        'bg': '🇧🇬', 'bulgarian': '🇧🇬',
        'hr': '🇭🇷', 'croatian': '🇭🇷',
        'sr': '🇷🇸', 'serbian': '🇷🇸',
        'sk': '🇸🇰', 'slovak': '🇸🇰',
        'sl': '🇸🇮', 'slovenian': '🇸🇮',
        'et': '🇪🇪', 'estonian': '🇪🇪',
        'lv': '🇱🇻', 'latvian': '🇱🇻',
        'lt': '🇱🇹', 'lithuanian': '🇱🇹',
        'ur': '🇵🇰', 'urdu': '🇵🇰',
        'fa': '🇮🇷', 'persian': '🇮🇷',
        'bn': '🇧🇩', 'bengali': '🇧🇩',
        'ta': '🇮🇳', 'tamil': '🇮🇳',
        'te': '🇮🇳', 'telugu': '🇮🇳',
        'mr': '🇮🇳', 'marathi': '🇮🇳',
        'gu': '🇮🇳', 'gujarati': '🇮🇳',
        'kn': '🇮🇳', 'kannada': '🇮🇳',
        'ml': '🇮🇳', 'malayalam': '🇮🇳',
        'pa': '🇮🇳', 'punjabi': '🇮🇳',
        'af': '🇿🇦', 'afrikaans': '🇿🇦',
        'sq': '🇦🇱', 'albanian': '🇦🇱',
        'am': '🇪🇹', 'amharic': '🇪🇹',
        'hy': '🇦🇲', 'armenian': '🇦🇲',
        'az': '🇦🇿', 'azerbaijani': '🇦🇿',
        'eu': '🇪🇸', 'basque': '🇪🇸',
        'be': '🇧🇾', 'belarusian': '🇧🇾',
        'bs': '🇧🇦', 'bosnian': '🇧🇦',
        'ca': '🇪🇸', 'catalan': '🇪🇸',
        'ga': '🇮🇪', 'irish': '🇮🇪',
        'cy': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'welsh': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
        'ka': '🇬🇪', 'georgian': '🇬🇪',
        'is': '🇮🇸', 'icelandic': '🇮🇸',
        'mk': '🇲🇰', 'macedonian': '🇲🇰',
        'mn': '🇲🇳', 'mongolian': '🇲🇳',
        'ne': '🇳🇵', 'nepali': '🇳🇵',
        'ps': '🇦🇫', 'pashto': '🇦🇫',
        'sw': '🇰🇪', 'swahili': '🇰🇪'
    };
    return flags[lang] || '🌐';
}

function buildTrackedPricingUrl({ serverId, serverName, userId, username, source = 'discord_limit_dm' }) {
    const isDev = process.env.NODE_ENV !== 'production';
    const websiteBaseUrl = isDev ? 'http://localhost:5173' : 'https://airtranslator.brevios.com';
    const params = new URLSearchParams({
        source,
        origin: 'discord-bot',
        provider: 'patreon',
        medium: 'button',
        serverId: String(serverId || ''),
        serverName: String(serverName || ''),
        userId: String(userId || ''),
        username: String(username || ''),
        clickId: `clk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    });
    return `${websiteBaseUrl}/patreon-redirect?${params.toString()}`;
}

function buildDashboardUrl() {
    const raw = (process.env.DASHBOARD_URL || 'https://airtranslator.brevios.com').trim();
    const base = raw.replace(/\/+$/, '');
    return base.endsWith('/dashboard') ? base : `${base}/dashboard`;
}

// Helper function to translate premium payment message into server languages
async function translatePremiumMessage(serverId) {
    try {
        const originalText = `✨ Unlock Full Access – Only $5/month ✨\n\nFollow these simple steps:\n1. Click the card button (💳) below or open the Patreon link: https://www.patreon.com/c/tsio/membership\n2. Subscribe to the membership plan you like.\n3. Come back to this Discord server and click the tick button (✅) to request approval.\n4. Type /premium to see your premium details.\n\nYour subscription is securely handled by Patreon.com, and we do not process your payment details directly.\n\nYou will get a notification when your premium plan is enabled.`;
        
        // Get server setup to find configured languages
        const serverSetup = await getServerSetups(serverId);
        if (!serverSetup) {
            return originalText; // No setup, return English only
        }
        
        // Collect all unique languages from server setups and server-wide translation
        const allLanguages = new Set();
        
        // Add server-wide languages if enabled
        if (serverSetup.serverWideTranslation && serverSetup.serverWideLanguages) {
            serverSetup.serverWideLanguages.forEach(lang => {
                if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                    allLanguages.add(lang.toLowerCase());
                }
            });
        }
        
        // Add languages from all channel setups
        if (serverSetup.setups && serverSetup.setups.length > 0) {
            serverSetup.setups.forEach(setup => {
                if (setup.languages && Array.isArray(setup.languages)) {
                    setup.languages.forEach(lang => {
                        if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                            allLanguages.add(lang.toLowerCase());
                        }
                    });
                }
            });
        }
        
        // Collect non-English languages for translation (filter out both 'en' code and 'english' full name)
        const targetLanguages = Array.from(allLanguages).filter(lang => lang !== 'en' && lang !== 'english');
        
        // If no other languages configured, return original English only
        if (targetLanguages.length === 0) {
            return originalText;
        }
        
        // Translate to all non-English configured languages using medium model
        const translations = await translateTextToMultipleLanguages(
            originalText,
            targetLanguages,
            'en',
            false,
            undefined,
            'mistral-medium-2508',
            'premium-button-message-create',
            { forceEscapedLineBreaks: true }
        );
        
        // Format with language labels
        const formattedParts = [];
        
        // Add English first
        formattedParts.push(`🇬🇧 **English:**\n${originalText}`);
        
        // Add other languages
        for (const lang of targetLanguages) {
            const translation = translations[lang];
            if (translation && translation.trim()) {
                const langFlag = getLanguageFlag(lang);
                const langName = getLanguageDisplayName(lang);
                formattedParts.push(`${langFlag} **${langName}:**\n${translation}`);
            }
        }
        
        return formattedParts.join('\n\n');
    } catch (error) {
        console.error('Error translating premium message:', {
            error: error?.message || error,
            stack: error?.stack,
            serverId,
            apiKeyPresent: !!process.env.MISTRAL_API_KEY
        });
        // Fallback to English on error
        return `✨ Unlock Full Access – Only $5/month ✨\n\nFollow these simple steps:\n1. Click the card button (💳) below or open the Patreon link: https://www.patreon.com/c/tsio/membership\n2. Subscribe to the membership plan you like.\n3. Come back to this Discord server and click the tick button (✅) to request approval.\n4. Type /premium to see your premium details.\n\nYour subscription is securely handled by Patreon.com, and we do not process your payment details directly.\n\nYou will get a notification when your premium plan is enabled.`;
    }
}

// Helper function to translate translation-limit message into server languages
async function translateLimitReachedMessage(serverId, freeTranslationLimit) {
    const originalText = `Your server has reached the free translation limit of **${freeTranslationLimit} messages**.\n\n🎯 Get More Translations\nVote to unlock up to **50 more free translations**!\n\n💎 Go Premium – Only $5/month\nEnjoy unlimited translations and full access to all premium features 🤖🚀\n👉 Tap the Paid Option button below to view pricing and subscribe.\n\n⏱️ Reset Schedule\nFree translations reset monthly for all servers.`;

    try {
        const serverSetup = await getServerSetups(serverId);
        if (!serverSetup) {
            return originalText;
        }

        const allLanguages = new Set();

        if (serverSetup.serverWideTranslation && serverSetup.serverWideLanguages) {
            serverSetup.serverWideLanguages.forEach(lang => {
                if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                    allLanguages.add(lang.toLowerCase());
                }
            });
        }

        if (serverSetup.setups && serverSetup.setups.length > 0) {
            serverSetup.setups.forEach(setup => {
                if (setup.languages && Array.isArray(setup.languages)) {
                    setup.languages.forEach(lang => {
                        if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                            allLanguages.add(lang.toLowerCase());
                        }
                    });
                }
            });
        }

        const targetLanguages = Array.from(allLanguages).filter(lang => lang !== 'en' && lang !== 'english');
        if (targetLanguages.length === 0) {
            return originalText;
        }

        const translations = await translateTextToMultipleLanguages(
            originalText,
            targetLanguages,
            'en',
            false,
            undefined,
            'mistral-medium-2508',
            'limit-message-create'
        );

        const formattedParts = [];
        formattedParts.push(`🇬🇧 **English:**\n${originalText}`);

        for (const lang of targetLanguages) {
            const translation = translations[lang];
            if (translation && translation.trim()) {
                const langFlag = getLanguageFlag(lang);
                const langName = getLanguageDisplayName(lang);
                formattedParts.push(`${langFlag} **${langName}:**\n${translation}`);
            }
        }

        return formattedParts.join('\n\n');
    } catch (error) {
        console.error('Error translating limit reached message:', {
            error: error?.message || error,
            stack: error?.stack,
            serverId,
            freeTranslationLimit,
            apiKeyPresent: !!process.env.MISTRAL_API_KEY
        });
        return originalText;
    }
}

// Helper function to translate vote message into server languages
async function translateVoteMessage(serverId) {
    try {
        const originalText = `Select where you want to vote to support Air Translator:

🔵 Vote on Top.gg
Get 35 free translations by clicking the button below.
You'll be redirected to the Top.gg bot page 🚀`;
        
        // Get server setup to find configured languages
        const serverSetup = await getServerSetups(serverId);
        if (!serverSetup) {
            return originalText; // No setup, return English only
        }
        
        // Collect all unique languages from server setups and server-wide translation
        const allLanguages = new Set();
        
        // Add server-wide languages if enabled
        if (serverSetup.serverWideTranslation && serverSetup.serverWideLanguages) {
            serverSetup.serverWideLanguages.forEach(lang => {
                if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                    allLanguages.add(lang.toLowerCase());
                }
            });
        }
        
        // Add languages from individual channel setups
        if (serverSetup.setups && serverSetup.setups.length > 0) {
            serverSetup.setups.forEach(setup => {
                if (setup.languages && Array.isArray(setup.languages)) {
                    setup.languages.forEach(lang => {
                        if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                            allLanguages.add(lang.toLowerCase());
                        }
                    });
                }
            });
        }
        
        // Collect non-English languages for translation (filter out both 'en' code and 'english' full name)
        const targetLanguages = Array.from(allLanguages).filter(lang => lang !== 'en' && lang !== 'english');
        
        // If no other languages configured, return original English only
        if (targetLanguages.length === 0) {
            return originalText;
        }
        
        // Translate to all non-English configured languages using medium model
        const translations = await translateTextToMultipleLanguages(
            originalText,
            targetLanguages,
            'en',
            false,
            undefined,
            'mistral-medium-2508',
            'vote-button-message-create',
            { forceEscapedLineBreaks: true }
        );
        
        // Format with language labels
        const formattedParts = [];
        
        // Add English first
        formattedParts.push(`🇬🇧 **English:**\n${originalText}`);
        
        // Add other languages
        for (const lang of targetLanguages) {
            const translation = translations[lang];
            if (translation && translation.trim()) {
                const langFlag = getLanguageFlag(lang);
                const langName = getLanguageDisplayName(lang);
                formattedParts.push(`${langFlag} **${langName}:**\n${translation}`);
            }
        }
        
        return formattedParts.join('\n\n');
    } catch (error) {
        console.error('Error translating vote message:', error);
        // Fallback to English on error
        return `Select where you want to vote to support AirTranslator:

🔵 Vote on Top.gg
Get 35 free translations`;
    }
}

// Store recent limit messages to avoid spam (serverId -> timestamp)
// Note: Cooldown removed to show limit message on every user message when limit is reached
const recentLimitMessages = new Map();
const LIMIT_MESSAGE_COOLDOWN = 0; // No cooldown - show message every time

// Vote tracking system for automatic credit granting
const pendingVotes = new Map(); // serverId -> { timestamp, timeout }
const VOTE_CREDIT_DELAY = 15 * 1000; // 15 seconds
const VOTE_BONUS_AMOUNT = 20; // Free translations to grant (can be overridden by admin dashboard setting)

// Function to start vote tracking and auto-grant credits
function startVoteTracking(serverId, userInfo = null, client = null) {
    // Clear any existing timeout for this server
    const existing = pendingVotes.get(serverId);
    if (existing && existing.timeout) {
        clearTimeout(existing.timeout);
    }
    
    // Set new timeout to grant credits after 15 seconds
    const timeout = setTimeout(async () => {
        try {
            console.log(`🎯 Auto-granting ${VOTE_BONUS_AMOUNT} free translations to server ${serverId} after vote button click`);
            
            // Grant bonus translations using the monetization service with user info
            const result = await monetizationService.handleVoteReward(userInfo?.id, serverId, VOTE_BONUS_AMOUNT);
            
            // handleVoteReward already records the vote event, no need to duplicate here
            
            if (result.success) {
                console.log(`✅ Successfully granted ${VOTE_BONUS_AMOUNT} bonus translations to server ${serverId} by user ${userInfo?.username || 'Unknown'}`);
                
                // Send confirmation message to the channel where limit was reached
                try {
                    if (client) {
                        const guild = client.guilds.cache.get(serverId);
                        if (guild) {
                            // Find a suitable channel to send confirmation
                            const me = guild.members.me;
                            const channel = guild.systemChannel || 
                                          guild.channels.cache.find(ch => 
                                              ch.type === 0 && 
                                              me &&
                                              ch.permissionsFor(me)?.has(['SendMessages', 'EmbedLinks'])
                                          );
                            
                            if (channel) {
                                const confirmEmbed = new EmbedBuilder()
                                    .setTitle('🎉 Free Credits Added!')
                                    .setDescription(`**${VOTE_BONUS_AMOUNT} free translations** have been added to this server.\n\nThanks to **${userInfo?.displayName || 'a user'}** for supporting AirTranslator!`)
                                    .setColor('#00ff88')
                                    .setFooter({
                                        text: 'AirTranslator • Vote rewards',
                                        iconURL: client.user.displayAvatarURL()
                                    })
                                    .setTimestamp();
                                
                                await channel.send({ embeds: [confirmEmbed] });
                            }
                        }
                    }
                } catch (confirmError) {
                    console.error('Error sending confirmation message:', confirmError);
                }
            } else {
                console.error(`❌ Failed to grant bonus translations to server ${serverId}:`, result.error);
            }
            
            // Remove from pending votes
            pendingVotes.delete(serverId);
            
        } catch (error) {
            console.error(`❌ Error granting vote bonus to server ${serverId}:`, error);
            pendingVotes.delete(serverId);
        }
    }, VOTE_CREDIT_DELAY);
    
    // Store the tracking info
    pendingVotes.set(serverId, {
        timestamp: Date.now(),
        timeout: timeout,
        userInfo: userInfo,
        client: client
    });
    
    console.log(`🗳️ Started vote tracking for server ${serverId} by user ${userInfo?.username || 'Unknown'} - credits will be granted in ${VOTE_CREDIT_DELAY/1000} seconds`);
}

// Auto-cleanup function for bot translation messages
async function scheduleAutoCleanupForBotMessages(messages, serverId, channelId) {
    try {
        if (!Array.isArray(messages) || messages.length === 0) return;
        
        const guildName = messages[0].guild?.name || 'Unknown Server';
        const channelName = messages[0].channel?.name || 'Unknown Channel';
        
        console.log(`🔧 DEBUG: Checking auto-cleanup for server: "${guildName}" (${serverId}), channel: #${channelName} (${channelId})`);
        const { getServerConfig } = require('../services/databaseService');
        const serverConfig = await getServerConfig(serverId);
        
        console.log(`🔧 DEBUG: Server config found:`, serverConfig ? 'YES' : 'NO');
        if (serverConfig && serverConfig.autoCleanup) {
            console.log(`🔧 DEBUG: Auto-cleanup config:`, JSON.stringify(serverConfig.autoCleanup, null, 2));
        }
        
        let cleanupDelay = null;

        // Resolve configured delay (only delete if explicitly enabled)
        if (serverConfig && serverConfig.autoCleanup) {
            // Channel-specific setting
            if (channelId && serverConfig.autoCleanup.channels && serverConfig.autoCleanup.channels[channelId]?.enabled) {
                cleanupDelay = serverConfig.autoCleanup.channels[channelId].delay;
                const delayText = cleanupDelay === 0 ? 'immediate' : `${Math.round(cleanupDelay / (60 * 1000))} minute(s)`;
                console.log(`🗑️ Using channel-specific cleanup (${delayText}) for channel: #${channelName} (${channelId})`);
            }
            // Server-wide setting
            else if (serverConfig.autoCleanup.serverWide?.enabled) {
                cleanupDelay = serverConfig.autoCleanup.serverWide.delay;
                const delayText = cleanupDelay === 0 ? 'immediate' : `${Math.round(cleanupDelay / (60 * 1000))} minute(s)`;
                console.log(`🗑️ Using server-wide cleanup (${delayText}) for server: "${guildName}" (${serverId})`);
            }
        }

        if (cleanupDelay === null || cleanupDelay === undefined) {
            console.log('🗑️ Auto-cleanup disabled or not configured; bot messages will be kept.');
            return;
        }

        const MIN_DELAY_MS = 60 * 1000;
        if (cleanupDelay < MIN_DELAY_MS) {
            console.log('⚠️ Cleanup delay below 1 minute detected; normalizing to 1 minute.');
            cleanupDelay = MIN_DELAY_MS;
        }

        const deleteOne = async (m) => {
            try {
                await m.delete().catch(() => {});
            } catch {}
        };

        if (cleanupDelay === 0) {
            // Immediate deletion of bot messages
            for (const m of messages) {
                await deleteOne(m);
            }
            console.log(`✅ Auto-deleted ${messages.length} bot message(s) immediately`);
        } else {
            setTimeout(async () => {
                let deleted = 0;
                for (const m of messages) {
                    try { await deleteOne(m); deleted++; } catch {}
                }
                console.log(`✅ Auto-deleted ${deleted}/${messages.length} bot message(s) after ${cleanupDelay/1000} seconds`);
            }, cleanupDelay);
        }
        
    } catch (error) {
        console.error('Error in scheduleAutoCleanup:', error);
    }
}

async function sendLimitReachedMessage(message) {
    try {
        const serverId = message.guild.id;
        const now = Date.now();
        
        // Check if we recently sent a limit message to this server
        const lastMessageTime = recentLimitMessages.get(serverId);
        if (lastMessageTime && (now - lastMessageTime) < LIMIT_MESSAGE_COOLDOWN) {
            return; // Don't spam limit messages
        }
        
        // Update last message time
        recentLimitMessages.set(serverId, now);
        
        const serverStats = await monetizationService.getServerStats(serverId);
        
        const translatedLimitDescription = await translateLimitReachedMessage(serverId, serverStats.freeTranslationLimit);

        const embed = new EmbedBuilder()
            .setTitle('🚫 Translation Limit Reached')
            .setDescription(translatedLimitDescription)
            .setColor('#e74c3c')
            .setFooter({
                text: 'Thank you for using AirTranslator!',
                iconURL: message.client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Note: Do not auto-grant credits here. Vote rewards are handled by Top.gg vote processing.
        
        const voteButton = new ButtonBuilder()
            .setCustomId(`vote_on_topgg:${message.guild.id}`)
            .setLabel('Vote to Unlock')
            .setEmoji('🗳️')
            .setStyle(ButtonStyle.Success);

        const supportButton = new ButtonBuilder()
            .setCustomId(`see_payment_options:${message.guild.id}`)
            .setLabel('Paid Options')
            .setStyle(ButtonStyle.Primary);

        const actionRow = new ActionRowBuilder()
            .addComponents(voteButton, supportButton);

        // Try to send to the current channel, fallback to system channel
        let targetChannel = message.channel;
        
        // If we can't send to current channel, try to find an appropriate channel
        const me = message.guild.members.me;
        if (!me || !targetChannel.permissionsFor(me)?.has(['SendMessages', 'EmbedLinks'])) {
            targetChannel = message.guild.systemChannel || 
                          message.guild.channels.cache.find(ch => 
                              ch.type === 0 && 
                              me &&
                              ch.permissionsFor(me)?.has(['SendMessages', 'EmbedLinks'])
                          );
        }

        if (targetChannel) {
            await targetChannel.send({
                embeds: [embed],
                components: [actionRow]
            });
        }

        // Try to DM the user with a private approval button
        try {
            // Get translated description based on server languages
            const translatedDescription = await translatePremiumMessage(message.guild.id);
            
            const dmEmbed = new EmbedBuilder()
                .setTitle('💎 Premium Payment Review')
                .setDescription(translatedDescription)
                .setColor('#5865F2')
                .addFields(
                    { name: 'Server', value: message.guild.name, inline: true },
                    { name: 'Server ID', value: message.guild.id, inline: true }
                )
                .setTimestamp();

            const trackedPricingUrl = buildTrackedPricingUrl({
                serverId: message.guild.id,
                serverName: message.guild.name,
                userId: message.author?.id,
                username: message.author?.username,
                source: 'discord_limit_dm'
            });

            const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('💳')
                    .setStyle(ButtonStyle.Link)
                    .setURL(trackedPricingUrl),
                new ButtonBuilder()
                    .setCustomId(`premium_request:${message.guild.id}`)
                    .setLabel('✅')
                    .setStyle(ButtonStyle.Primary)
            );

            await message.author.send({ embeds: [dmEmbed], components: [dmRow] });
        } catch (dmErr) {
            console.log('Could not DM user about premium request button. DMs may be closed.');
        }
    } catch (error) {
        console.error('Error sending limit reached message:', error);
    }
}

// Global translation queue with controlled concurrency
const translationQueue = fastq.promise(worker, 1000); // High concurrency, effectively no cap

async function worker(task) {
    // No internal rate limiting; process task immediately
    return task();
}

async function translateAndReply(message, languages, options = {}) {
    console.log(`[DEBUG] Translation started for server: "${message.guild.name}" (${message.guild.id})`, { 
        languages,
        forQuickSetup: options.forQuickSetup,
        channel: message.channel.name 
    });
    try {
        const { forQuickSetup = false } = options;
        const botMessages = [];

        let isServerExempt = false;
        try {
            const serverStats = await monetizationService.getServerStats(message.guild.id);
            isServerExempt = Boolean(serverStats?.isExempt);
        } catch (error) {
            console.warn(`Failed to fetch monetization status for ${message.guild.id}:`, error?.message || error);
        }

        // Check if this channel should use thread-based translation
        const useThreadTranslation = await shouldUseThreadTranslation(message.guild.id, message.channel.id);
        
        // Detect the language only once for efficiency
        const detectedLanguage = await detectLanguage(message.content);
        console.log(`Detected language: ${detectedLanguage} for message: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`);

        // Track languages we've already translated to in this channel to avoid duplicates
        const alreadyTranslatedTo = new Set();
        
        // Process all translations in parallel
        const targetLanguagesArray = languages.filter(language => {
            if (language === AUTO_DETECT_LANGUAGE) return false;
            if (language.toLowerCase() === 'zh' && detectedLanguage.toLowerCase() === 'zh-tw') return true;
            if (language.toLowerCase() === 'zh-tw' && detectedLanguage.toLowerCase() === 'zh') return true;
            if (language.toLowerCase() === detectedLanguage.toLowerCase()) return false;
            if (alreadyTranslatedTo.has(language.toLowerCase())) return false;
            return true;
        });
        
        if (targetLanguagesArray.length === 0) return;
        
        // Single API call for all languages with automatic failover
        const translations = await translationQueue.push(async () => {
            const toneSettings = await getToneSettings(message.guild.id, message.channel.id);
            
            // Get available API keys
            const activeApiKeys = translationQueueService.apiKeys && translationQueueService.apiKeys.length > 0
                ? translationQueueService.apiKeys
                : [undefined];

            // Try each API key until one succeeds
            let lastError = null;
            for (let i = 0; i < activeApiKeys.length; i++) {
                const apiKey = activeApiKeys[i];
                try {
                    console.log(`🔄 [Translation] Batch translating ${targetLanguagesArray.length} languages using API key ${i + 1}/${activeApiKeys.length}`);
                    
                    const result = await translateTextToMultipleLanguages(
                        message.content,
                        targetLanguagesArray,
                        detectedLanguage,
                        toneSettings,
                        apiKey
                    );
                    
                    console.log(`✅ [Translation] Success with API key ${i + 1}: ${Object.keys(result).length} translations`);
                    return result;
                    
                } catch (error) {
                    lastError = error;
                    const isLastKey = i === activeApiKeys.length - 1;
                    
                    if (!isLastKey) {
                        console.warn(`⚠️ [Translation] API key ${i + 1} failed (${error?.message}), trying next key...`);
                    } else {
                        console.error(`❌ [Translation] All API keys exhausted. Last error:`, error?.message);
                    }
                }
            }
            
            // If all API keys failed, throw the last error
            if (lastError) {
                throw lastError;
            }
            
            return {}; // Return empty object if no translations succeeded
        });
        
        // Record analytics for successful translations
        for (const [language, translation] of Object.entries(translations)) {
            if (translation && translation.length > 0) {
                analyticsService.recordTranslation(detectedLanguage, language, message.channel.id, message.author.id);
                console.log(`✅ Translated to ${language} for message`);
            }
        }
        
        // If we have translations, send them with modern design
        const translationEntries = Object.entries(translations).filter(([, t]) => typeof t === 'string' && t.length > 0);
        if (translationEntries.length > 0) {
            const MAX_FIELDS_PER_EMBED = 6; // Limit fields per embed for better readability
            const chunks = [];
            
            // Process translations in chunks for multiple embeds if needed
            for (let i = 0; i < translationEntries.length; i += MAX_FIELDS_PER_EMBED) {
                chunks.push(translationEntries.slice(i, i + MAX_FIELDS_PER_EMBED));
            }

            // Send each chunk as a modern embed
            for (let i = 0; i < chunks.length; i++) {
                // Track which languages are too long to fit in an embed field
                const longTranslations = [];
                const fields = chunks[i].map(([language, translation]) => {
                    const flag = getLanguageFlag(language);
                    
                    const displayLanguage = getLanguageDisplayName(language);
                    
                    // If translation fits in an embed field (<= 1024), show it fully.
                    // Otherwise, show a short preview and send full text below as messages.
                    let displayTranslation = translation;
                    const EMBED_FIELD_LIMIT = 1024;
                    if (translation.length > EMBED_FIELD_LIMIT) {
                        longTranslations.push({ language, displayLanguage, translation });
                        const previewLen = 300;
                        displayTranslation = translation.substring(0, previewLen) + '...\n\n— View full translation below —';
                    }
                    
                    return {
                        name: `${flag} ${displayLanguage}`,
                        value: displayTranslation,
                        inline: false
                    };
                });
                
                const embed = new EmbedBuilder()
                    .setColor('#129af5') // Blue color
                    .setFields(fields);
                
                if (i === 0) {
                    // First embed gets the author info
                    embed.setAuthor({
                        name: `${message.author.displayName}`,
                        iconURL: message.author.displayAvatarURL({ dynamic: true, size: 128 })
                    });
                }
                
                const replyOptions = {
                    embeds: [embed],
                    allowedMentions: { repliedUser: false }
                };
                
                // Add interactive buttons only to the last embed
                if (i === chunks.length - 1) {
                    const buttons = isServerExempt
                        ? new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('Dashboard')
                                .setStyle(ButtonStyle.Link)
                                .setURL(buildDashboardUrl())
                        )
                        : new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`vote_on_topgg:${message.guild.id}`)
                                .setLabel('Free (Vote)')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`see_payment_options:${message.guild.id}`)
                                .setLabel('Paid Options')
                                .setStyle(ButtonStyle.Primary)
                        );

                    replyOptions.components = [buttons];
                }
                
                // Handle thread-based or text-based translation
                if (useThreadTranslation) {
                    // Thread-based translation
                    let thread = null;
                    
                    // Check if message already has a thread with our translation pattern
                    if (message.hasThread) {
                        // Look for existing translation thread
                        const existingThread = message.channel.threads.cache.find(t => 
                            t.ownerId === message.client.user.id && 
                            t.name.startsWith('Translation:')
                        );
                        if (existingThread) {
                            thread = existingThread;
                        }
                    }
                    
                    // Create new thread if none exists
                    if (!thread) {
                        const threadName = targetLanguagesArray.length === 1 
                            ? `💬 Translation: ${getLanguageDisplayName(targetLanguagesArray[0])}`
                            : `💬 Translation: ${getLanguageDisplayName(targetLanguagesArray[0])} +${targetLanguagesArray.length - 1} more`;
                        thread = await message.startThread({
                            name: threadName.substring(0, 100), // Discord thread name limit
                            autoArchiveDuration: 60, // Auto-archive after 1 hour of inactivity
                            reason: 'Translation thread for automatic message translation'
                        });
                        
                        // Make thread less intrusive by adding a helpful message and archiving quickly
                        const threadIntroEmbed = new EmbedBuilder()
                            .setColor(0x0099FF)
                            .setDescription(`🧵 **Translation Thread**\n*Translations will appear here and auto-archive in 30 seconds*\n\n📌 *Tip: Access archived translations by clicking the original message*`)
                            .setFooter({ text: 'Air Translator • Clean translation organization' });
                        
                        await thread.send({ 
                            embeds: [threadIntroEmbed],
                            flags: ['SuppressEmbeds', 'SuppressNotifications'] // Don't show previews and mute notifications
                        });
                        
                        console.log(`🧵 Created translation thread: ${thread.name}`);
                    }
                    
                    // Send translation to thread
                    const silentReplyOptions = {
                        ...replyOptions,
                        flags: ['SuppressNotifications'] // Mute thread translation notifications
                    };
                    const sent = await thread.send(silentReplyOptions);
                    botMessages.push(sent);
                    console.log(`🧵 Sent translation to thread: ${thread.name}`);

                    // Send full long translations as embed cards in the thread
                    for (const item of longTranslations) {
                        const header = `Full translation — ${item.displayLanguage}`;
                        const parts = splitIntoDiscordChunks(item.translation, 3800); // Safe size for embed description
                        for (let p = 0; p < parts.length; p++) {
                            const partSuffix = parts.length > 1 ? ` (Part ${p + 1}/${parts.length})` : '';
                            const card = new EmbedBuilder()
                                .setColor('#129af5')
                                .setTitle(`${header}${partSuffix}`)
                                .setDescription(parts[p]);
                            await thread.send({
                                embeds: [card],
                                allowedMentions: { repliedUser: false },
                                flags: ['SuppressNotifications']
                            });
                        }
                    }

                    // Add helpful context message after translation (only on last chunk)
                    if (i === chunks.length - 1) {
                        const contextEmbed = new EmbedBuilder()
                            .setColor(0x2F3136)
                            .setDescription('💡 *This thread auto-archives in 30s to keep channels tidy. Click the original message to access archived translations.*')
                            .setFooter({ text: 'Air Translator' });
                        
                        const ctxMsg = await thread.send({ 
                            embeds: [contextEmbed],
                            flags: ['SuppressNotifications'] // Mute context message notifications
                        });
                        botMessages.push(ctxMsg);
                    }
                    
                    // Auto-archive thread after 30 seconds to keep channel list tidy
                    if (i === chunks.length - 1) { // Only set timeout on the last chunk
                        setTimeout(async () => {
                            try {
                                if (thread && !thread.archived) {
                                    await thread.setArchived(true, 'Auto-archiving translation thread to keep channel tidy');
                                    console.log(`📦 Auto-archived thread: ${thread.name}`);
                                }
                            } catch (error) {
                                console.error('Error auto-archiving thread:', error);
                            }
                        }, 30 * 1000); // 30 seconds
                    }
                } else {
                    // Text-based translation (original behavior)
                    const msg = await message.reply(replyOptions);
                    botMessages.push(msg);

                    // Send full long translations as embed cards in the channel
                    for (const item of longTranslations) {
                        const header = `Full translation — ${item.displayLanguage}`;
                        const parts = splitIntoDiscordChunks(item.translation, 3800); // Safe size for embed description
                        for (let p = 0; p < parts.length; p++) {
                            const partSuffix = parts.length > 1 ? ` (Part ${p + 1}/${parts.length})` : '';
                            const card = new EmbedBuilder()
                                .setColor('#129af5')
                                .setTitle(`${header}${partSuffix}`)
                                .setDescription(parts[p]);
                            const fullMsg = await message.channel.send({
                                embeds: [card],
                                allowedMentions: { repliedUser: false }
                            });
                            botMessages.push(fullMsg);
                        }
                    }
                }
                
                // Check for auto-cleanup configuration and schedule deletion of original message
                if (i === chunks.length - 1) { // Only check on the last chunk
                    await scheduleAutoCleanupForBotMessages(botMessages, message.guild.id, message.channel.id);
                }
            }
            
            // Increment translation count after successful translation
            const updatedServer = await monetizationService.incrementTranslationCount(message.guild.id);

            await maybeSendUnlimitedUsageOffer({
                guild: message.guild,
                preferredChannel: message.channel,
                serverSnapshot: updatedServer
            });

            console.log(`✅ Translation count incremented for server: "${message.guild.name}" (${message.guild.id})`);
        }
    } catch (error) {
        console.error('Error in translateAndReply:', error);
    }
}

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.content.trim()) return;

    // Handle Personal Translation in DMs (private inboxes)
    if (!message.guild) {
        return;
    }

    // Track user-server interaction for vote rewards
    if (!global.userServerTracking) {
        global.userServerTracking = new Map();
    }
    global.userServerTracking.set(message.author.id, message.guild.id);
    
    // Clean up old entries (keep only last 24 hours)
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (!global.lastCleanup || Date.now() - global.lastCleanup > oneDayMs) {
        // Simple cleanup - in production you'd want more sophisticated tracking
        global.lastCleanup = Date.now();
    }

    try {
        // Check if server can translate (monetization check)
        const canTranslate = await monetizationService.canTranslate(message.guild.id);
        if (!canTranslate) {
            // Send limit reached message with voting link
            await sendLimitReachedMessage(message);
            return;
        }

        const server = await Server.findOne({ serverId: message.guild.id });
        
        // Check if server-wide translation is enabled
        if (server?.serverWideTranslation) {
            // Skip if channel is excluded
            if (server.serverWideExcludedChannels.includes(message.channel.id)) {
                return;
            }
            
            // Get all unique target languages from server setups
            const allLanguages = [...new Set(
                server.setups.flatMap(setup => 
                    setup.languages.map(lang => lang.toLowerCase())
                )
            )];
            
            // Update server with aggregated languages if different
            if (allLanguages.length > 0 && 
                JSON.stringify(allLanguages) !== JSON.stringify(server.serverWideLanguages?.map(l => l.toLowerCase()))) {
                await updateServerConfig(message.guild.id, {
                    serverWideLanguages: allLanguages
                });
            }
            
            // Proceed with translation using server-wide languages
            if (allLanguages.length > 0) {
                await translateAndReply(message, allLanguages);
                return; // Skip channel-specific checks when server-wide is enabled
            }
        }

        // Fall back to channel-specific setups only if server-wide is disabled
        const matchingSetups = await getSetupsByChannelId(message.guild.id, message.channel.id);
        if (!matchingSetups || matchingSetups.length === 0) return;

        // Combine languages from all matching setups
        const languages = [...new Set(
            matchingSetups.flatMap(setup => 
                setup.languages.map(lang => lang.toLowerCase())
            )
        )];
        
        await translateAndReply(message, languages, { forQuickSetup: true });
    } catch (error) {
        console.error('Error processing message:', error);
        
        // Queue the message for later processing if translation failed
        try {
            await translationQueueService.queueMessage({
                messageId: message.id,
                channelId: message.channel.id,
                serverId: message.guild.id,
                content: message.content,
                status: 'failed'
            });
        } catch (queueError) {
            console.error('Failed to queue message for retry:', queueError);
        }
    }
};
