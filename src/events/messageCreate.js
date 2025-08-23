const { getSetupsByChannelId, getToneSettings, updateServerConfig, shouldUseThreadTranslation } = require('../services/databaseService');
const { translateText, detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const monetizationService = require('../services/monetizationService');
const fastq = require('fastq');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');
const translationQueueService = require('../services/translationQueueService');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Server = require('../models/Server');

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

// Auto-cleanup function for original messages
async function scheduleAutoCleanup(message, serverId) {
    try {
        console.log(`🔧 DEBUG: Checking auto-cleanup for server ${serverId}, channel ${message.channel.name}`);
        const { getServerConfig } = require('../services/databaseService');
        const serverConfig = await getServerConfig(serverId);
        
        console.log(`🔧 DEBUG: Server config found:`, serverConfig ? 'YES' : 'NO');
        if (serverConfig && serverConfig.autoCleanup) {
            console.log(`🔧 DEBUG: Auto-cleanup config:`, JSON.stringify(serverConfig.autoCleanup, null, 2));
        }
        
        if (!serverConfig || !serverConfig.autoCleanup) {
            console.log(`🔧 DEBUG: No auto-cleanup configuration found for server ${serverId}`);
            return;
        }
        
        let cleanupDelay = null;
        
        // Check channel-specific configuration first
        if (serverConfig.autoCleanup.channels && serverConfig.autoCleanup.channels[message.channel.id]?.enabled) {
            cleanupDelay = serverConfig.autoCleanup.channels[message.channel.id].delay;
            const delayText = cleanupDelay === 0 ? 'immediate' : `${cleanupDelay/1000}s`;
            console.log(`🗑️ Using channel-specific cleanup (${delayText}) for #${message.channel.name}`);
        }
        // Fall back to server-wide configuration
        else if (serverConfig.autoCleanup.serverWide?.enabled) {
            cleanupDelay = serverConfig.autoCleanup.serverWide.delay;
            const delayText = cleanupDelay === 0 ? 'immediate' : `${cleanupDelay/1000}s`;
            console.log(`🗑️ Using server-wide cleanup (${delayText}) for original message`);
        }
        
        if (!cleanupDelay && cleanupDelay !== 0) {
            console.log(`🔧 DEBUG: No cleanup delay configured (cleanupDelay = ${cleanupDelay})`);
            return;
        }
        
        if (cleanupDelay === 0) {
            // Immediate deletion
            try {
                await message.delete();
                console.log(`✅ Auto-deleted original message immediately`);
            } catch (deleteError) {
                console.log('Could not delete original message (may already be deleted or no permissions)');
            }
        } else {
            // Delayed deletion
            setTimeout(async () => {
                try {
                    await message.delete();
                    console.log(`✅ Auto-deleted original message after ${cleanupDelay/1000} seconds`);
                } catch (deleteError) {
                    console.log('Could not delete original message (may already be deleted or no permissions)');
                }
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

        // Start vote tracking for this server with user info
        const userInfo = {
            id: message.author.id,
            username: message.author.username,
            displayName: message.author.displayName || message.author.username,
            displayAvatarURL: () => message.author.displayAvatarURL({ dynamic: true, size: 64 })
        };
        startVoteTracking(message.guild.id, userInfo, message.client);
        
        const voteButton = new ButtonBuilder()
            .setLabel('🗳️ Vote on Top.gg')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://top.gg/bot/1380177061032759416/vote?guild=${message.guild.id}`); // Server-specific vote tracking

        const supportButton = new ButtonBuilder()
            .setLabel('💎 Premium Plans')
            .setStyle(ButtonStyle.Link)
            .setURL('https://your-website.com/premium'); // Replace with your premium plans URL

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

async function translateAndReply(message, languages) {
    try {
        // Check if this channel should use thread-based translation
        const useThreadTranslation = await shouldUseThreadTranslation(message.guild.id, message.channel.id);
        
        // Immediately place a placeholder reply under the original message (non-thread mode only)
        let placeholderReply = null;
        if (!useThreadTranslation) {
            try {
                placeholderReply = await message.reply({
                    content: 'Translating…',
                    allowedMentions: { repliedUser: false }
                });
            } catch (e) {
                console.log('Could not send placeholder reply:', e?.message || e);
            }
        }
        
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
        
        if (targetLanguagesArray.length === 0) {
            // Nothing to translate (e.g., target list equals detected language)
            if (placeholderReply) {
                try {
                    await placeholderReply.edit({
                        content: 'No translation needed for this message.',
                        allowedMentions: { repliedUser: false }
                    });
                } catch (_) {}
            }
            return;
        }
        
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
            if (translation && translation.length > 0 && translation !== message.content) {
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
                const fields = chunks[i].map(([language, translation]) => {
                    const flag = {
                        'afrikaans': '🇿🇦', 'albanian': '🇦🇱', 'amharic': '🇪🇹', 'arabic': '🇸🇦',
                        'armenian': '🇦🇲', 'azerbaijani': '🇦🇿', 'basque': '🇪🇸', 'belarusian': '🇧🇾',
                        'bengali': '🇧🇩', 'bosnian': '🇧🇦', 'bulgarian': '🇧🇬', 'burmese': '🇲🇲',
                        'catalan': '🇪🇸', 'cebuano': '🇵🇭', 'chinese': '🇨🇳', 'corsican': '🇫🇷',
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
                    
                    // Truncate very long translations and add "..." if needed
                    let displayTranslation = translation;
                    if (translation.length > 500) {
                        displayTranslation = translation.substring(0, 497) + '...';
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
                            .setLabel('Vote on Top.gg')
                            .setEmoji('🗳️')
                            .setURL(`https://top.gg/bot/1380177061032759416/vote?guild=${message.guild.id}`)
                            .setStyle(ButtonStyle.Link)
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
                    await thread.send(silentReplyOptions);
                    console.log(`🧵 Sent translation to thread: ${thread.name}`);
                    
                    // Add helpful context message after translation (only on last chunk)
                    if (i === chunks.length - 1) {
                        const contextEmbed = new EmbedBuilder()
                            .setColor(0x2F3136)
                            .setDescription('💡 *This thread auto-archives in 30s to keep channels tidy. Click the original message to access archived translations.*')
                            .setFooter({ text: 'Air Translator' });
                        
                        await thread.send({ 
                            embeds: [contextEmbed],
                            flags: ['SuppressNotifications'] // Mute context message notifications
                        });
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
                    // Text-based translation with immediate placeholder edit for the first chunk
                    if (i === 0 && placeholderReply) {
                        try {
                            await placeholderReply.edit({
                                content: 'Translated',
                                ...replyOptions
                            });
                        } catch (editErr) {
                            console.log('Failed to edit placeholder, sending new reply instead');
                            await message.reply(replyOptions);
                        }
                    } else {
                        await message.reply(replyOptions);
                    }
                }
                
                // Check for auto-cleanup configuration and schedule deletion of original message
                if (i === chunks.length - 1) { // Only check on the last chunk
                    await scheduleAutoCleanup(message, message.guild.id);
                }
            }
            
            // Increment translation count after successful translation
            await monetizationService.incrementTranslationCount(message.guild.id);
            console.log(`✅ Translation count incremented for server: ${message.guild.id}`);
        }
    } catch (error) {
        console.error('Error in translateAndReply:', error);
        // Best-effort update to placeholder if one exists
        try {
            if (typeof placeholderReply !== 'undefined' && placeholderReply) {
                await placeholderReply.edit({
                    content: '⚠️ Failed to translate this message. Please try again.',
                    allowedMentions: { repliedUser: false }
                });
            }
        } catch (_) {}
    }
}

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.trim()) return;

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
        
        await translateAndReply(message, languages);
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