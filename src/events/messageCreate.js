const { getSetupsByChannelId, getToneSettings, updateServerConfig, shouldUseThreadTranslation } = require('../services/databaseService');
const { getPersonalTranslationSettings, recordPersonalTranslation } = require('../services/databaseService');
const { translateText, detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const monetizationService = require('../services/monetizationService');
const fastq = require('fastq');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');
const translationQueueService = require('../services/translationQueueService');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Server = require('../models/Server');
const TTSSettings = require('../models/TTSSettings');
const { synthesizeMultispeaker } = require('../services/ttsService');
const { validateLanguages } = require('../services/ttsLanguageHelper');
const { playBufferInChannel } = require('../services/voicePlaybackServiceSimple');

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
    const displayNames = {
        'afrikaans': 'Afrikaans', 'albanian': 'Albanian', 'amharic': 'Amharic', 'arabic': 'Arabic',
        'armenian': 'Armenian', 'azerbaijani': 'Azerbaijani', 'basque': 'Basque', 'belarusian': 'Belarusian',
        'bengali': 'Bengali', 'bosnian': 'Bosnian', 'bulgarian': 'Bulgarian', 'burmese': 'Burmese',
        'catalan': 'Catalan', 'cebuano': 'Cebuano', 'chinese': 'Chinese', 'chinese (simplified)': 'Chinese (Simplified)',
        'chinese (traditional)': 'Chinese (Traditional)', 'corsican': 'Corsican', 'croatian': 'Croatian',
        'czech': 'Czech', 'danish': 'Danish', 'dutch': 'Dutch', 'english': 'English',
        'esperanto': 'Esperanto', 'estonian': 'Estonian', 'filipino': 'Filipino', 'finnish': 'Finnish',
        'french': 'French', 'frisian': 'Frisian', 'galician': 'Galician', 'georgian': 'Georgian',
        'german': 'German', 'greek': 'Greek', 'gujarati': 'Gujarati', 'haitian': 'Haitian Creole',
        'hausa': 'Hausa', 'hawaiian': 'Hawaiian', 'hebrew': 'Hebrew', 'hindi': 'Hindi',
        'hmong': 'Hmong', 'hungarian': 'Hungarian', 'icelandic': 'Icelandic', 'igbo': 'Igbo',
        'indonesian': 'Indonesian', 'irish': 'Irish', 'italian': 'Italian', 'japanese': 'Japanese',
        'javanese': 'Javanese', 'kannada': 'Kannada', 'kazakh': 'Kazakh', 'khmer': 'Khmer',
        'kinyarwanda': 'Kinyarwanda', 'korean': 'Korean', 'kurdish': 'Kurdish', 'kyrgyz': 'Kyrgyz',
        'lao': 'Lao', 'latin': 'Latin', 'latvian': 'Latvian', 'lithuanian': 'Lithuanian',
        'luxembourgish': 'Luxembourgish', 'macedonian': 'Macedonian', 'malagasy': 'Malagasy', 'malay': 'Malay',
        'malayalam': 'Malayalam', 'maltese': 'Maltese', 'maori': 'Maori', 'marathi': 'Marathi',
        'mongolian': 'Mongolian', 'nepali': 'Nepali', 'norwegian': 'Norwegian', 'nyanja': 'Nyanja',
        'odia': 'Odia', 'pashto': 'Pashto', 'persian': 'Persian', 'polish': 'Polish',
        'portuguese': 'Portuguese', 'punjabi': 'Punjabi', 'romanian': 'Romanian', 'russian': 'Russian',
        'samoan': 'Samoan', 'scots': 'Scots Gaelic', 'serbian': 'Serbian', 'sesotho': 'Sesotho',
        'shona': 'Shona', 'sindhi': 'Sindhi', 'sinhala': 'Sinhala', 'slovak': 'Slovak',
        'slovenian': 'Slovenian', 'somali': 'Somali', 'spanish': 'Spanish', 'sundanese': 'Sundanese',
        'swahili': 'Swahili', 'swedish': 'Swedish', 'tagalog': 'Tagalog', 'tajik': 'Tajik',
        'tamil': 'Tamil', 'tatar': 'Tatar', 'telugu': 'Telugu', 'thai': 'Thai',
        'turkish': 'Turkish', 'turkmen': 'Turkmen', 'ukrainian': 'Ukrainian', 'urdu': 'Urdu',
        'uyghur': 'Uyghur', 'uzbek': 'Uzbek', 'vietnamese': 'Vietnamese', 'welsh': 'Welsh',
        'xhosa': 'Xhosa', 'yiddish': 'Yiddish', 'yoruba': 'Yoruba', 'zulu': 'Zulu'
    };
    return displayNames[language.toLowerCase()] || language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
}

// Store recent limit messages to avoid spam (serverId -> timestamp)
// Note: Cooldown removed to show limit message on every user message when limit is reached
const recentLimitMessages = new Map();
const LIMIT_MESSAGE_COOLDOWN = 0; // No cooldown - show message every time

// Vote tracking system for automatic credit granting
const pendingVotes = new Map(); // serverId -> { timestamp, timeout }
const VOTE_CREDIT_DELAY = 15 * 1000; // 15 seconds
const VOTE_BONUS_AMOUNT = 50; // Free translations to grant

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
                            const channel = guild.systemChannel || 
                                          guild.channels.cache.find(ch => 
                                              ch.type === 0 && 
                                              ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])
                                          );
                            
                            if (channel) {
                                const confirmEmbed = new EmbedBuilder()
                                    .setTitle('🎉 Free Credits Added!')
                                    .setDescription(`**${VOTE_BONUS_AMOUNT} free translations** have been added to your server!`)
                                    .setColor('#00ff88')
                                    .addFields({
                                        name: '✨ Thank you!',
                                        value: `Thanks to ${userInfo?.displayName || 'a user'} for supporting AirTranslator!`,
                                        inline: false
                                    })
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
        console.log(`🔧 DEBUG: Checking auto-cleanup for server ${serverId}, channel ${channelId}`);
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
                console.log(`🗑️ Using channel-specific cleanup (${delayText}) for channel ${channelId}`);
            }
            // Server-wide setting
            else if (serverConfig.autoCleanup.serverWide?.enabled) {
                cleanupDelay = serverConfig.autoCleanup.serverWide.delay;
                const delayText = cleanupDelay === 0 ? 'immediate' : `${Math.round(cleanupDelay / (60 * 1000))} minute(s)`;
                console.log(`🗑️ Using server-wide cleanup (${delayText}) for server ${serverId}`);
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
        
        const embed = new EmbedBuilder()
            .setTitle('🚫 Translation Limit Reached')
            .setDescription(`Your server has reached the free translation limit of **${serverStats.freeTranslationLimit} messages**.`)
            .setColor('#e74c3c')
            .addFields(
                {
                    name: '🎯 Get More Translations',
                    value: 'Vote for AirTranslator on Top.gg to unlock **50 more free translations**!',
                    inline: false
                },
                {
                    name: '⏱️ Reset Schedule',
                    value: 'Free translations reset monthly for all servers.',
                    inline: false
                }
            )
            .setFooter({
                text: 'Thank you for using AirTranslator!',
                iconURL: message.client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Note: Do not auto-grant credits here. Vote rewards are handled by Top.gg vote processing.
        
        const voteButton = new ButtonBuilder()
            .setCustomId(`vote_on_topgg:${message.guild.id}`)
            .setLabel('Vote on Top.gg')
            .setStyle(ButtonStyle.Secondary);

        const supportButton = new ButtonBuilder()
            .setCustomId(`see_payment_options:${message.guild.id}`)
            .setLabel('Paid Options')
            .setStyle(ButtonStyle.Primary);

        const actionRow = new ActionRowBuilder()
            .addComponents(voteButton, supportButton);

        // Try to send to the current channel, fallback to system channel
        let targetChannel = message.channel;
        
        // If we can't send to current channel, try to find an appropriate channel
        if (!targetChannel.permissionsFor(message.guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
            targetChannel = message.guild.systemChannel || 
                          message.guild.channels.cache.find(ch => 
                              ch.type === 0 && 
                              ch.permissionsFor(message.guild.members.me)?.has(['SendMessages', 'EmbedLinks'])
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
            const dmEmbed = new EmbedBuilder()
                .setTitle('💎 Premium Payment Review')
                .setDescription('If you have completed the premium payment, press the button below to request approval. Our team will review and exempt your server shortly.')
                .setColor('#5865F2')
                .addFields(
                    { name: 'Server', value: message.guild.name, inline: true },
                    { name: 'Server ID', value: message.guild.id, inline: true }
                )
                .setTimestamp();

            const requestApprovalButton = new ButtonBuilder()
                .setCustomId(`premium_request:${message.guild.id}`)
                .setLabel('✅ I Paid - Request Approval')
                .setStyle(ButtonStyle.Primary);

            const dmRow = new ActionRowBuilder().addComponents(requestApprovalButton);

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
    console.log('[DEBUG] Translation started', { 
        languages,
        forQuickSetup: options.forQuickSetup,
        channel: message.channel.name 
    });
    try {
        const { forQuickSetup = false } = options;
        const botMessages = [];
        // Check if this channel should use thread-based translation
        const useThreadTranslation = await shouldUseThreadTranslation(message.guild.id, message.channel.id);
        
        // Detect the language only once for efficiency
        const detectedLanguage = await detectLanguage(message.content);
        console.log(`Detected language: ${detectedLanguage} for message: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`);

        // Track languages we've already translated to in this channel to avoid duplicates
        const alreadyTranslatedTo = new Set();
        
        // Process all translations in parallel
        const targetLanguagesArray = languages.filter(language => 
            language !== AUTO_DETECT_LANGUAGE && 
            language.toLowerCase() !== detectedLanguage.toLowerCase() &&
            !alreadyTranslatedTo.has(language.toLowerCase())
        );
        
        if (targetLanguagesArray.length === 0) return;
        
        // Use dual-API translation for real-time processing
        const translations = await translationQueue.push(async () => {
            const toneSettings = await getToneSettings(message.guild.id, message.channel.id);
            
            // Split languages between APIs for parallel processing
            const languagesPerApi = Math.ceil(targetLanguagesArray.length / 2);
            const api1Languages = targetLanguagesArray.slice(0, languagesPerApi);
            const api2Languages = targetLanguagesArray.slice(languagesPerApi);
            
            const translationPromises = [];
            
            if (api1Languages.length > 0) {
                console.log(`🔄 API 1 processing: ${api1Languages.join(', ')}`);
                translationPromises.push(
                    translateTextToMultipleLanguages(
                        message.content, 
                        api1Languages, 
                        detectedLanguage, 
                        toneSettings,
                        translationQueueService.apiKeys[0]
                    )
                );
            }
            
            if (api2Languages.length > 0) {
                console.log(`🔄 API 2 processing: ${api2Languages.join(', ')}`);
                translationPromises.push(
                    translateTextToMultipleLanguages(
                        message.content, 
                        api2Languages, 
                        detectedLanguage, 
                        toneSettings,
                        translationQueueService.apiKeys[1]
                    )
                );
            }
            
            // Wait for all translations and combine results
            const results = await Promise.all(translationPromises);
            return Object.assign({}, ...results);
        });
        
        // Record analytics for successful translations
        for (const [language, translation] of Object.entries(translations)) {
            if (translation && translation.length > 0) {
                analyticsService.recordTranslation(detectedLanguage, language, message.channel.id, message.author.id);
                console.log(`✅ Translated to ${language} for message`);
            }
        }
        
        // If we have translations, send them with modern design
        if (Object.keys(translations).length > 0) {
            const translationEntries = Object.entries(translations);
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
                    const flag = {
                        'afrikaans': '🇿🇦', 'albanian': '🇦🇱', 'amharic': '🇪🇹', 'arabic': '🇸🇦',
                        'armenian': '🇦🇲', 'azerbaijani': '🇦🇿', 'basque': '🇪🇸', 'belarusian': '🇧🇾',
                        'bengali': '🇧🇩', 'bosnian': '🇧🇦', 'bulgarian': '🇧🇬', 'burmese': '🇲🇲',
                        'catalan': '🇪🇸', 'cebuano': '🇵🇭', 'chinese': '🇨🇳', 'chinese (simplified)': '🇨🇳', 'chinese (traditional)': '🇹🇼', 'corsican': '🇫🇷',
                        'croatian': '🇭🇷', 'czech': '🇨🇿', 'danish': '🇩🇰', 'dutch': '🇳🇱',
                        'english': '🇬🇧', 'esperanto': '🏳️', 'estonian': '🇪🇪', 'filipino': '🇵🇭',
                        'finnish': '🇫🇮', 'french': '🇫🇷', 'frisian': '🇳🇱', 'galician': '🇪🇸',
                        'georgian': '🇬🇪', 'german': '🇩🇪', 'greek': '🇬🇷', 'gujarati': '🇮🇳',
                        'haitian': '🇭🇹', 'hausa': '🇳🇬', 'hawaiian': '🇺🇸', 'hebrew': '🇮🇱',
                        'hindi': '🇮🇳', 'hmong': '🇨🇳', 'hungarian': '🇭🇺', 'icelandic': '🇮🇸',
                        'igbo': '🇳🇬', 'indonesian': '🇮🇩', 'irish': '🇮🇪', 'italian': '🇮🇹',
                        'japanese': '🇯🇵', 'javanese': '🇮🇩', 'kannada': '🇮🇳', 'kazakh': '🇰🇿',
                        'khmer': '🇰🇭', 'kinyarwanda': '🇷🇼', 'korean': '🇰🇷', 'kurdish': '🇮🇶',
                        'kyrgyz': '🇰🇬', 'lao': '🇱🇦', 'latin': '🏛️', 'latvian': '🇱🇻',
                        'lithuanian': '🇱🇹', 'luxembourgish': '🇱🇺', 'macedonian': '🇲🇰', 'malagasy': '🇲🇬',
                        'malay': '🇲🇾', 'malayalam': '🇮🇳', 'maltese': '🇲🇹', 'maori': '🇳🇿',
                        'marathi': '🇮🇳', 'mongolian': '🇲🇳', 'nepali': '🇳🇵', 'norwegian': '🇳🇴',
                        'nyanja': '🇲🇼', 'odia': '🇮🇳', 'pashto': '🇦🇫', 'persian': '🇮🇷',
                        'polish': '🇵🇱', 'portuguese': '🇵🇹', 'punjabi': '🇮🇳', 'romanian': '🇷🇴',
                        'russian': '🇷🇺', 'samoan': '🇼🇸', 'scots': '🏴', 'serbian': '🇷🇸',
                        'sesotho': '🇱🇸', 'shona': '🇿🇼', 'sindhi': '🇵🇰', 'sinhala': '🇱🇰',
                        'slovak': '🇸🇰', 'slovenian': '🇸🇮', 'somali': '🇸🇴', 'spanish': '🇪🇸',
                        'sundanese': '🇮🇩', 'swahili': '🇰🇪', 'swedish': '🇸🇪', 'tagalog': '🇵🇭',
                        'tajik': '🇹🇯', 'tamil': '🇮🇳', 'tatar': '🇷🇺', 'telugu': '🇮🇳',
                        'thai': '🇹🇭', 'turkish': '🇹🇷', 'turkmen': '🇹🇲', 'ukrainian': '🇺🇦',
                        'urdu': '🇵🇰', 'uyghur': '🇨🇳', 'uzbek': '🇺🇿', 'vietnamese': '🇻🇳',
                        'welsh': '🏴', 'xhosa': '🇿🇦', 'yiddish': '🇮🇱', 'yoruba': '🇳🇬',
                        'zulu': '🇿🇦'
                    }[language.toLowerCase()] || '🌐';
                    
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
                    // First embed gets the header with original message preview
                    const originalText = message.content.length > 150 
                        ? message.content.substring(0, 147) + '...' 
                        : message.content;
                        
                    embed.setAuthor({
                        name: `${message.author.displayName}`,
                        iconURL: message.author.displayAvatarURL({ dynamic: true, size: 128 })
                    })
                    .setDescription(`> ${originalText}`);
                }
                
                const replyOptions = {
                    embeds: [embed],
                    allowedMentions: { repliedUser: false }
                };
                
                // Add interactive buttons only to the last embed
                if (i === chunks.length - 1) {
                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`vote_on_topgg:${message.guild.id}`)
                            .setLabel('Vote on Top.gg')
                            .setStyle(ButtonStyle.Secondary),
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
            await monetizationService.incrementTranslationCount(message.guild.id);
            console.log(`✅ Translation count incremented for server: ${message.guild.id}`);

            // TTS playback: only for quick-setup path and when configured
            if (forQuickSetup) {
                try {
                    const ttsSettings = await TTSSettings.findOne({ guildId: message.guild.id }).lean();
                    console.log('[DEBUG] TTS Attempt', {
                        voiceChannel: ttsSettings?.voiceChannelId,
                        textChannel: message.channel.id,
                        matching: message.channel.id === ttsSettings?.textChannelId
                    });
                    if (ttsSettings?.enabled && message.channel.id === ttsSettings.textChannelId) {
                        // Respect max 2 languages and intersect with produced translations
                        const desired = Array.from(new Set((ttsSettings.languages || []).map(l => String(l).toLowerCase()))).slice(0, 2);
                        const availablePairs = desired
                            .map(l => [l, translations[l]])
                            .filter(([l, t]) => typeof t === 'string' && t.trim().length > 0);

                        if (availablePairs.length > 0) {
                            // Build multi-speaker script
                            const [first, second] = availablePairs;
                            const primaryVoice = ttsSettings?.voices?.primary || null;
                            console.log('[TTS] Settings:', {
                                guildId: message.guild.id,
                                textChannelId: ttsSettings.textChannelId,
                                voiceChannelId: ttsSettings.voiceChannelId,
                                desiredLanguages: desired,
                                availableLanguages: availablePairs.map(([l]) => l),
                                primaryVoice,
                            });
                            
                            // Debug: Log the actual translation pairs
                            console.log('[TTS] Translation pairs:', {
                                first: { language: first[0], text: first[1] },
                                second: second ? { language: second[0], text: second[1] } : undefined
                            });
                            
                            // For Mimic3, speak only the translated content without labels
                            let script = first[1];
                            if (second) {
                                script += `\n\n${second[1]}`;
                            }

                            console.log('[TTS] Script to synthesize:', script);
                            if (!primaryVoice) {
                                console.warn('[TTS] No user-selected voice configured. Skipping synthesis.');
                                return;
                            }
                            console.log('[TTS] Synthesizing audio...');
                            const audioBuffer = await synthesizeMultispeaker(script, {
                                voice1: primaryVoice,
                            });
                            console.log('[TTS] Synthesis result bytes:', audioBuffer ? audioBuffer.length : 0);
                            if (audioBuffer && audioBuffer.length > 0) {
                                const voiceChannel = message.guild.channels.cache.get(ttsSettings.voiceChannelId);
                                if (voiceChannel && voiceChannel.joinable) {
                                    console.log('[TTS] Playing in voice channel', { channelId: voiceChannel.id, name: voiceChannel.name });
                                    await playBufferInChannel(voiceChannel, audioBuffer);
                                }
                                else {
                                    console.warn('[TTS] Voice channel not joinable or not found', { voiceChannelId: ttsSettings.voiceChannelId });
                                }
                            } else {
                                console.warn('[TTS] No audio buffer returned from synthesis');
                            }
                        }
                        else {
                            console.warn('[TTS] No available translations match desired languages', { desired, translationsAvailable: Object.keys(translations) });
                        }
                    }
                } catch (ttsErr) {
                    console.error('TTS process error:', ttsErr);
                }
            }
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
        try {
            const userId = message.author.id;
            const settings = await getPersonalTranslationSettings(userId);

            if (settings && settings.enabled && Array.isArray(settings.targetLanguages) && settings.targetLanguages.length > 0) {
                // Detect language once
                const detectedLanguage = await detectLanguage(message.content);

                // Filter out same-language targets
                const targetLanguagesArray = settings.targetLanguages
                    .filter(l => typeof l === 'string' && l.trim().length > 0)
                    .map(l => l.trim())
                    .filter(l => l.toLowerCase() !== detectedLanguage.toLowerCase());

                if (targetLanguagesArray.length === 0) return;

                // Perform translations (no tone setting for DMs for now)
                const translations = await translateTextToMultipleLanguages(
                    message.content,
                    targetLanguagesArray,
                    detectedLanguage,
                    false
                );

                if (Object.keys(translations).length > 0) {
                    // Prepare embed(s) similar to guild path, without server-specific buttons
                    const translationEntries = Object.entries(translations);
                    const MAX_FIELDS_PER_EMBED = 6;
                    const chunks = [];
                    for (let i = 0; i < translationEntries.length; i += MAX_FIELDS_PER_EMBED) {
                        chunks.push(translationEntries.slice(i, i + MAX_FIELDS_PER_EMBED));
                    }

                    for (let i = 0; i < chunks.length; i++) {
                        const longTranslations = [];
                        const fields = chunks[i].map(([language, translation]) => {
                            const flag = {
                                'afrikaans': '🇿🇦', 'albanian': '🇦🇱', 'amharic': '🇪🇹', 'arabic': '🇸🇦',
                                'armenian': '🇦🇲', 'azerbaijani': '🇦🇿', 'basque': '🇪🇸', 'belarusian': '🇧🇾',
                                'bengali': '🇧🇩', 'bosnian': '🇧🇦', 'bulgarian': '🇧🇬', 'burmese': '🇲🇲',
                                'catalan': '🇪🇸', 'cebuano': '🇵🇭', 'chinese': '🇨🇳', 'chinese (simplified)': '🇨🇳', 'chinese (traditional)': '🇹🇼', 'corsican': '🇫🇷',
                                'croatian': '🇭🇷', 'czech': '🇨🇿', 'danish': '🇩🇰', 'dutch': '🇳🇱',
                                'english': '🇬🇧', 'esperanto': '🏳️', 'estonian': '🇪🇪', 'filipino': '🇵🇭',
                                'finnish': '🇫🇮', 'french': '🇫🇷', 'frisian': '🇳🇱', 'galician': '🇪🇸',
                                'georgian': '🇬🇪', 'german': '🇩🇪', 'greek': '🇬🇷', 'gujarati': '🇮🇳',
                                'haitian': '🇭🇹', 'hausa': '🇳🇬', 'hawaiian': '🇺🇸', 'hebrew': '🇮🇱',
                                'hindi': '🇮🇳', 'hmong': '🇨🇳', 'hungarian': '🇭🇺', 'icelandic': '🇮🇸',
                                'igbo': '🇳🇬', 'indonesian': '🇮🇩', 'irish': '🇮🇪', 'italian': '🇮🇹',
                                'japanese': '🇯🇵', 'javanese': '🇮🇩', 'kannada': '🇮🇳', 'kazakh': '🇰🇿',
                                'khmer': '🇰🇭', 'kinyarwanda': '🇷🇼', 'korean': '🇰🇷', 'kurdish': '🇮🇶',
                                'kyrgyz': '🇰🇬', 'lao': '🇱🇦', 'latin': '🏛️', 'latvian': '🇱🇻',
                                'lithuanian': '🇱🇹', 'luxembourgish': '🇱🇺', 'macedonian': '🇲🇰', 'malagasy': '🇲🇬',
                                'malay': '🇲🇾', 'malayalam': '🇮🇳', 'maltese': '🇲🇹', 'maori': '🇳🇿',
                                'marathi': '🇮🇳', 'mongolian': '🇲🇳', 'nepali': '🇳🇵', 'norwegian': '🇳🇴',
                                'nyanja': '🇲🇼', 'odia': '🇮🇳', 'pashto': '🇦🇫', 'persian': '🇮🇷',
                                'polish': '🇵🇱', 'portuguese': '🇵🇹', 'punjabi': '🇮🇳', 'romanian': '🇷🇴',
                                'russian': '🇷🇺', 'samoan': '🇼🇸', 'scots': '🏴', 'serbian': '🇷🇸',
                                'sesotho': '🇱🇸', 'shona': '🇿🇼', 'sindhi': '🇵🇰', 'sinhala': '🇱🇰',
                                'slovak': '🇸🇰', 'slovenian': '🇸🇮', 'somali': '🇸🇴', 'spanish': '🇪🇸',
                                'sundanese': '🇮🇩', 'swahili': '🇰🇪', 'swedish': '🇸🇪', 'tagalog': '🇵🇭',
                                'tajik': '🇹🇯', 'tamil': '🇮🇳', 'tatar': '🇷🇺', 'telugu': '🇮🇳',
                                'thai': '🇹🇭', 'turkish': '🇹🇷', 'turkmen': '🇹🇲', 'ukrainian': '🇺🇦',
                                'urdu': '🇵🇰', 'uyghur': '🇨🇳', 'uzbek': '🇺🇿', 'vietnamese': '🇻🇳',
                                'welsh': '🏴', 'xhosa': '🇿🇦', 'yiddish': '🇮🇱', 'yoruba': '🇳🇬',
                                'zulu': '🇿🇦'
                            }[language.toLowerCase()] || '🌐';

                            const displayLanguage = getLanguageDisplayName(language);

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
                            .setColor('#129af5')
                            .setFields(fields);

                        if (i === 0) {
                            const originalText = message.content.length > 150
                                ? message.content.substring(0, 147) + '...'
                                : message.content;
                            embed.setAuthor({
                                name: `${message.author.displayName || message.author.username}`,
                                iconURL: message.author.displayAvatarURL({ dynamic: true, size: 128 })
                            })
                            .setDescription(`> ${originalText}`);
                        }

                        await message.reply({
                            embeds: [embed],
                            allowedMentions: { repliedUser: false }
                        });

                        // Send full long translations as additional embed cards in DM
                        for (const item of longTranslations) {
                            const header = `Full translation — ${item.displayLanguage}`;
                            const parts = splitIntoDiscordChunks(item.translation, 3800);
                            for (let p = 0; p < parts.length; p++) {
                                const partSuffix = parts.length > 1 ? ` (Part ${p + 1}/${parts.length})` : '';
                                const card = new EmbedBuilder()
                                    .setColor('#129af5')
                                    .setTitle(`${header}${partSuffix}`)
                                    .setDescription(parts[p]);
                                await message.channel.send({
                                    embeds: [card],
                                    allowedMentions: { repliedUser: false }
                                });
                            }
                        }
                    }

                    // Record usage for analytics
                    await recordPersonalTranslation(userId);
                }
            }
        } catch (error) {
            console.error('Error handling personal DM translation:', error);
        }
        return; // Do not proceed to guild logic for DMs
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

    // Personal Translation for guild messages: DM translations privately to the author
    try {
        const personal = await getPersonalTranslationSettings(message.author.id);
        if (personal && personal.enabled && Array.isArray(personal.targetLanguages) && personal.targetLanguages.length > 0) {
            const detectedLanguage = await detectLanguage(message.content);
            const targetLanguagesArray = personal.targetLanguages
                .filter(l => typeof l === 'string' && l.trim().length > 0)
                .map(l => l.trim())
                .filter(l => l.toLowerCase() !== detectedLanguage.toLowerCase());

            if (targetLanguagesArray.length > 0) {
                const translations = await translateTextToMultipleLanguages(
                    message.content,
                    targetLanguagesArray,
                    detectedLanguage,
                    await getToneSettings(message.guild.id, message.channel.id)
                );

                if (Object.keys(translations).length > 0) {
                    // Build DM embeds
                    const entries = Object.entries(translations);
                    const MAX_FIELDS_PER_EMBED = 6;
                    for (let i = 0; i < entries.length; i += MAX_FIELDS_PER_EMBED) {
                        const slice = entries.slice(i, i + MAX_FIELDS_PER_EMBED);
                        const fields = slice.map(([language, translation]) => ({
                            name: `${getLanguageDisplayName(language)}`,
                            value: translation.length > 1024 ? translation.substring(0, 1000) + '...\n\n— Truncated —' : translation,
                            inline: false
                        }));
                        const embed = new EmbedBuilder()
                            .setColor('#06b6d4')
                            .setTitle('🗣️ Personal Translation')
                            .setDescription(`From: ${message.guild.name} • #${message.channel.name}`)
                            .addFields(fields)
                            .setFooter({ text: 'AirTranslator • Personal Mode' })
                            .setTimestamp();
                        try {
                            await message.author.send({ embeds: [embed] });
                        } catch (dmErr) {
                            // Ignore if DMs closed
                        }
                    }
                    await recordPersonalTranslation(message.author.id);
                }
            }
        }
    } catch (e) {
        console.error('Error sending personal guild DM translation:', e);
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
