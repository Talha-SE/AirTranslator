const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getFlagLanguage, getLanguageDisplayName } = require('../utils/flagMapping');
const { translateText, detectLanguage, analyzeAndTranslateImage } = require('../services/mistralService');

const FLAG_TRANSLATION_MODEL = 'mistral-large-latest';
const { getPersonalTranslationSettings, recordPersonalTranslation, getToneSettings } = require('../services/databaseService');
const monetizationService = require('../services/monetizationService');
const analyticsService = require('../services/analyticsService');

// Local vote tracking (mirrors messageCreate.js behavior) for flag-reaction path
const VOTE_CREDIT_DELAY = 15 * 1000; // 15 seconds
const VOTE_BONUS_AMOUNT = 50; // Free translations to grant

async function startVoteTrackingForServer(serverId, userInfo, client) {
    try {
        setTimeout(async () => {
            try {
                console.log(`🎯 Auto-granting ${VOTE_BONUS_AMOUNT} free translations to server ${serverId} after vote button click (flag path)`);
                const result = await monetizationService.handleVoteReward(userInfo?.id, serverId, VOTE_BONUS_AMOUNT);
                if (result.success) {
                    console.log(`✅ Successfully granted ${VOTE_BONUS_AMOUNT} bonus translations to server ${serverId} by user ${userInfo?.username || 'Unknown'} (flag path)`);
                    try {
                        if (client) {
                            const guild = client.guilds.cache.get(serverId);
                            if (guild) {
                                const channel = guild.systemChannel || guild.channels.cache.find(ch => ch.type === 0 && ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks']));
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
                        console.error('Error sending confirmation message (flag path):', confirmError);
                    }
                } else {
                    console.error(`❌ Failed to grant bonus translations to server ${serverId}:`, result.error);
                }
            } catch (error) {
                console.error(`❌ Error granting vote bonus to server ${serverId} (flag path):`, error);
            }
        }, VOTE_CREDIT_DELAY);
        console.log(`🗳️ Started vote tracking (flag path) for server ${serverId} by user ${userInfo?.username || 'Unknown'} - credits in ${VOTE_CREDIT_DELAY/1000}s`);
    } catch (e) {
        console.error('Failed to start vote tracking (flag path):', e);
    }
}

async function messageReactionAdd(client, reaction, user) {
    // Ignore bot reactions
    if (user.bot) return;

    try {
        console.log(`🔍 Reaction received from ${user.username} in ${reaction.message?.guild?.name || 'UnknownServer'}: ${reaction.emoji.name}`);
        
        // If the reaction is partial, fetch it
        if (reaction.partial) {
            console.log('📥 Fetching partial reaction...');
            try {
                await reaction.fetch();
                console.log('✅ Partial reaction fetched successfully');
            } catch (error) {
                console.error('❌ Could not fetch partial reaction:', error.message);
                return;
            }
        }

        // If the message is partial, fetch it
        if (reaction.message.partial) {
            console.log('📥 Fetching partial message...');
            try {
                await reaction.message.fetch();
                console.log('✅ Partial message fetched successfully');
            } catch (error) {
                console.error('❌ Could not fetch partial message:', error.message);
                return;
            }
        }

        const message = reaction.message;
        const flagEmoji = reaction.emoji.name;
        const guildInfo = message.guild ? `${message.guild.name} (${message.guild.id})` : 'DM/Unknown';
        const channelInfo = message.channel ? `#${message.channel.name} (${message.channel.id})` : 'UnknownChannel';
        
        console.log(`📝 Message details - Server: ${guildInfo} • Channel: ${channelInfo} • Author: ${message.author?.username || 'Unknown'}, Content: "${message.content?.substring(0, 50) || 'No content'}${message.content?.length > 50 ? '...' : ''}"`);
        
        // Check if this is a flag emoji we support
        const targetLanguage = getFlagLanguage(flagEmoji);
        if (!targetLanguage) {
            console.log(`⚠️ Unsupported flag emoji: ${flagEmoji} • Server: ${guildInfo}`);
            return;
        }

        console.log(`🏴 Flag reaction detected: ${flagEmoji} -> ${targetLanguage} by user ${user.username}`);

        // Check for personal translation buddy settings - works everywhere
        const personalSettings = await getPersonalTranslationSettings(user.id);
        if (personalSettings) {
            console.log(`👤 Personal translation buddy active for ${user.username} - processing universally`);
            
            // Check if message has content or images to translate
            const hasTextContent = message.content && message.content.trim().length > 0;
            const hasImages = message.attachments && message.attachments.size > 0;
            const imageAttachments = hasImages ? 
                Array.from(message.attachments.values()).filter(att => 
                    att.contentType && att.contentType.startsWith('image/')
                ) : [];

            if (!hasTextContent && imageAttachments.length === 0) {
                console.log('⚠️ Message has no content or images to translate');
                return;
            }

            // Allow personal translations even on bot messages when user reacts with a flag
            // We no longer skip bot messages here to honor user's explicit flag action

            try {
                // Prepare content for unified translation system (same as server translation)
                let contentToTranslate = '';
                let detectedLanguage = 'unknown';
                
                // Handle text content
                if (hasTextContent) {
                    contentToTranslate = message.content;
                    detectedLanguage = await detectLanguage(message.content);
                    console.log(`🔍 Detected text language: ${detectedLanguage}`);
                }
                
                // Handle image attachments - extract text and add to content
                if (imageAttachments.length > 0) {
                    console.log(`🖼️ Processing ${imageAttachments.length} image(s) for text extraction`);
                    
                    for (let i = 0; i < Math.min(imageAttachments.length, 3); i++) {
                        const attachment = imageAttachments[i];
                        try {
                            console.log(`📸 Analyzing image ${i + 1}/${Math.min(imageAttachments.length, 3)}: ${attachment.name}`);
                            const imageAnalysis = await analyzeAndTranslateImage(attachment.url, 'en'); // Extract in English first
                            
                            if (imageAnalysis.hasText && imageAnalysis.extractedText) {
                                // Add extracted text to content for unified translation
                                const imageText = imageAnalysis.extractedText.trim();
                                if (imageText.length > 0) {
                                    if (contentToTranslate.length > 0) {
                                        contentToTranslate += '\n\n--- Image Text ---\n';
                                    }
                                    contentToTranslate += imageText;
                                    
                                    // Update detected language if we only had image content
                                    if (!hasTextContent) {
                                        detectedLanguage = imageAnalysis.detectedLanguage || await detectLanguage(imageText);
                                    }
                                    
                                    console.log(`✅ Extracted text from ${attachment.name}: "${imageText.substring(0, 50)}..."`);
                                }
                            } else {
                                console.log(`ℹ️ No text found in ${attachment.name}`);
                            }
                        } catch (imageError) {
                            console.error(`❌ Error processing image ${attachment.name}:`, imageError.message);
                        }
                    }
                }

                // Check if we have content to translate
                if (!contentToTranslate || contentToTranslate.trim().length === 0) {
                    console.log('❌ No translatable content found');
                    return;
                }

                // Skip if already in target language
                if (detectedLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
                    console.log(`⚠️ Content already in ${targetLanguage}, skipping personal translation`);
                    return;
                }

                // Use unified translation system with same tone setting as auto-translation
                const toneSettings = message.guild ? await getToneSettings(message.guild.id, message.channel.id) : false;
                console.log(`🔄 Personal buddy translating content from ${detectedLanguage} to ${targetLanguage}`);
                const translation = await translateText(contentToTranslate, targetLanguage, detectedLanguage, toneSettings, undefined, FLAG_TRANSLATION_MODEL);
                
                if (!translation || translation.trim().length === 0) {
                    console.log('❌ Personal translation failed or returned empty result');
                    return;
                }

                // Create DM embed - only show translation, no original text
                const personalEmbed = new EmbedBuilder()
                    .setTitle(`${flagEmoji} Personal Translation Buddy`)
                    .setColor('#6366f1')
                    .setDescription(`✨ Your personal translation for **${getLanguageDisplayName(targetLanguage)}**`)
                    .addFields({
                        name: `🎯 Translation • ${getLanguageDisplayName(targetLanguage)} ${flagEmoji}`,
                        value: translation.length > 1000 ? translation.substring(0, 997) + '...' : translation,
                        inline: false
                    })

                // Add message context with better formatting (supports DMs and Guilds)
                if (message.guild) {
                    personalEmbed.addFields({
                        name: '🏠 Message Source',
                        value: `**🏢 Server:** ${message.guild.name}\n**📢 Channel:** #${message.channel.name}\n**👤 Author:** ${message.author.username}\n**🔗 Link:** [Jump to message](${message.url})`,
                        inline: false
                    });
                } else {
                    personalEmbed.addFields({
                        name: '🏠 Message Source',
                        value: `**📬 Direct Message**\n**👤 Author:** ${message.author.username}`,
                        inline: false
                    });
                }

                personalEmbed
                    .setFooter({
                        text: `Personal Translation Buddy • React with any flag emoji for instant translations • Requested by ${user.username}`,
                        iconURL: client.user.displayAvatarURL()
                    })
                    .setTimestamp()
                    .setThumbnail(message.author.displayAvatarURL());

                // Send to user's DM
                await user.send({ embeds: [personalEmbed] });
                
                // Record the personal translation
                await recordPersonalTranslation(user.id);
                
                console.log(`✅ Personal translation sent to ${user.username}'s DM`);
                return; // Exit early for personal translations
                
            } catch (error) {
                console.error(`❌ Error in personal translation for ${user.username}:`, error);
                
                try {
                    await user.send({
                        content: '❌ Sorry, there was an error processing your personal translation. Please try again later.',
                    });
                } catch (dmError) {
                    console.error('Could not send error message to user DM');
                }
                return;
            }
        }

        // Continue with server-based translation logic if no personal buddy is active
        console.log(`📋 Processing server-based translation for ${targetLanguage}`);

        // Check if message has content or images to translate
        const hasTextContent = message.content && message.content.trim().length > 0;
        const hasImages = message.attachments && message.attachments.size > 0;
        const imageAttachments = hasImages ? 
            Array.from(message.attachments.values()).filter(att => 
                att.contentType && att.contentType.startsWith('image/')
            ) : [];

        if (!hasTextContent && imageAttachments.length === 0) {
            console.log('⚠️ Message has no content or images to translate');
            return;
        }

        console.log(`📋 Processing: ${hasTextContent ? 'Text' : ''}${hasTextContent && imageAttachments.length > 0 ? ' + ' : ''}${imageAttachments.length > 0 ? `${imageAttachments.length} image(s)` : ''}`);

        // For server-based flow: allow translating this bot's own messages when user explicitly reacts,
        // but avoid loops by skipping known translation embeds we created.
        if (message.author.bot) {
            const isOurBot = message.author.id === client.user.id;
            if (isOurBot) {
                // If this message looks like our own translation embed, skip to prevent infinite loops
                const looksLikeOurTranslation = Array.isArray(message.embeds) && message.embeds.some(e =>
                    (e?.footer?.text && /Auto-deletes in 15 min/i.test(e.footer.text)) ||
                    (e?.author?.name && typeof e.author.name === 'string' && e.fields?.some?.(f => f?.name && f?.value))
                );
                if (looksLikeOurTranslation) {
                    console.log('⚠️ Skipping our own translation embed to avoid loops');
                    return;
                }
                console.log('✅ Allowing translation of our bot message due to explicit user flag reaction');
            } else {
                console.log('⚠️ Skipping message from another bot');
                return;
            }
        }

        console.log(`📝 Processing message from ${message.author.username}${hasTextContent ? `: "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}"` : ''}`);

        // Check server monetization limits
        const serverId = message.guild.id;
        const canTranslate = await monetizationService.canTranslate(serverId);
        
        if (!canTranslate) {
            console.log(`❌ Server ${serverId} has reached translation limit`);

            try {
                // Fetch server stats for consistent messaging
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
                        iconURL: client.user.displayAvatarURL()
                    })
                    .setTimestamp();

                const voteButton = new ButtonBuilder()
                    .setCustomId(`vote_on_topgg:${message.guild.id}`)
                    .setLabel('Vote on Top.gg')
                    .setEmoji('🗳️')
                    .setStyle(ButtonStyle.Success);

                const supportButton = new ButtonBuilder()
                    .setCustomId(`see_payment_options:${message.guild.id}`)
                    .setLabel('See Payment Options')
                    .setStyle(ButtonStyle.Primary);

                const actionRow = new ActionRowBuilder().addComponents(voteButton, supportButton);

                // Note: Do not auto-grant credits here. Vote rewards are handled by Top.gg vote processing only.

                // Try to send to the current channel, fallback to system channel or first text channel with perms
                let targetChannel = message.channel;
                if (!targetChannel.permissionsFor(message.guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
                    targetChannel = message.guild.systemChannel ||
                        message.guild.channels.cache.find(ch => ch.type === 0 && ch.permissionsFor(message.guild.members.me)?.has(['SendMessages', 'EmbedLinks']));
                }

                if (targetChannel) {
                    await targetChannel.send({ embeds: [embed], components: [actionRow] });
                }

                // DM the user the private approval button
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
                    await user.send({ embeds: [dmEmbed], components: [dmRow] });
                } catch (dmErr) {
                    console.log('Could not DM user about premium request button (flag path). DMs may be closed.');
                }
            } catch (limitMsgError) {
                console.error('Error sending limit reached message (flag path):', limitMsgError);
            }
            return;
        }

        // Prepare content for unified translation system
        let contentToTranslate = '';
        let detectedLanguage = 'unknown';
        
        // Handle text content
        if (hasTextContent) {
            contentToTranslate = message.content;
            detectedLanguage = await detectLanguage(message.content);
            console.log(`🔍 Detected text language: ${detectedLanguage}`);
        }
        
        // Handle image attachments - extract text and add to content
        if (imageAttachments.length > 0) {
            console.log(`🖼️ Processing ${imageAttachments.length} image(s) for text extraction`);
            
            for (let i = 0; i < Math.min(imageAttachments.length, 3); i++) {
                const attachment = imageAttachments[i];
                try {
                    console.log(`📸 Analyzing image ${i + 1}/${Math.min(imageAttachments.length, 3)}: ${attachment.name}`);
                    const imageAnalysis = await analyzeAndTranslateImage(attachment.url, 'en'); // Extract in English first
                    
                    if (imageAnalysis.hasText && imageAnalysis.extractedText) {
                        // Add extracted text to content for unified translation
                        const imageText = imageAnalysis.extractedText.trim();
                        if (imageText.length > 0) {
                            if (contentToTranslate.length > 0) {
                                contentToTranslate += '\n\n--- Image Text ---\n';
                            }
                            contentToTranslate += imageText;
                            
                            // Update detected language if we only had image content
                            if (!hasTextContent) {
                                detectedLanguage = imageAnalysis.detectedLanguage || await detectLanguage(imageText);
                            }
                            
                            console.log(`✅ Extracted text from ${attachment.name}: "${imageText.substring(0, 50)}..."`);
                        }
                    } else {
                        console.log(`ℹ️ No text found in ${attachment.name}`);
                    }
                } catch (imageError) {
                    console.error(`❌ Error processing image ${attachment.name}:`, imageError.message);
                }
            }
        }

        // Check if we have content to translate
        if (!contentToTranslate || contentToTranslate.trim().length === 0) {
            console.log('❌ No translatable content found');
            return;
        }

        // Skip if already in target language
        if (detectedLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
            console.log(`⚠️ Content already in ${targetLanguage}, skipping translation`);
            return;
        }

        // Use unified translation system with same tone setting as auto-translation
        const toneSettings = await getToneSettings(message.guild.id, message.channel.id);
        console.log(`🔄 Translating content from ${detectedLanguage} to ${targetLanguage} using unified system`);
        const translation = await translateText(contentToTranslate, targetLanguage, detectedLanguage, toneSettings, undefined, FLAG_TRANSLATION_MODEL);
        
        if (!translation || translation.trim().length === 0) {
            console.log('❌ Translation failed or returned empty result');
            return;
        }

        // Update usage count
        await monetizationService.incrementTranslationCount(serverId);
        
        // Track analytics
        analyticsService.recordTranslation(detectedLanguage, targetLanguage, message.channel.id, user.id);

        // Use the same UI design as auto-translation system
        const flag = {
            'afrikaans': '🇿🇦', 'albanian': '🇦🇱', 'amharic': '🇪🇹', 'arabic': '🇸🇦',
            'armenian': '🇦🇲', 'azerbaijani': '🇦🇿', 'basque': '🇪🇸', 'belarusian': '🇧🇾',
            'bengali': '🇧🇩', 'bosnian': '🇧🇦', 'bulgarian': '🇧🇬', 'catalan': '🇪🇸',
            'cebuano': '🇵🇭', 'chichewa': '🇲🇼', 'chinese': '🇨🇳', 'chinese (traditional)': '🇹🇼', 'zh-TW': '🇹🇼', 'zh-tw': '🇹🇼', 'corsican': '🇫🇷',
            'croatian': '🇭🇷', 'czech': '🇨🇿', 'danish': '🇩🇰', 'dutch': '🇳🇱',
            'english': '🇺🇸', 'esperanto': '🌍', 'estonian': '🇪🇪', 'filipino': '🇵🇭',
            'finnish': '🇫🇮', 'french': '🇫🇷', 'frisian': '🇳🇱', 'galician': '🇪🇸',
            'georgian': '🇬🇪', 'german': '🇩🇪', 'greek': '🇬🇷', 'gujarati': '🇮🇳',
            'haitian': '🇭🇹', 'hausa': '🇳🇬', 'hawaiian': '🇺🇸', 'hebrew': '🇮🇱',
            'hindi': '🇮🇳', 'hmong': '🇱🇦', 'hungarian': '🇭🇺', 'icelandic': '🇮🇸',
            'igbo': '🇳🇬', 'indonesian': '🇮🇩', 'irish': '🇮🇪', 'italian': '🇮🇹',
            'japanese': '🇯🇵', 'javanese': '🇮🇩', 'kannada': '🇮🇳', 'kazakh': '🇰🇿',
            'khmer': '🇰🇭', 'korean': '🇰🇷', 'kurdish': '🇮🇶', 'kyrgyz': '🇰🇬',
            'lao': '🇱🇦', 'latin': '🇻🇦', 'latvian': '🇱🇻', 'lithuanian': '🇱🇹',
            'luxembourgish': '🇱🇺', 'macedonian': '🇲🇰', 'malagasy': '🇲🇬', 'malay': '🇲🇾',
            'malayalam': '🇮🇳', 'maltese': '🇲🇹', 'maori': '🇳🇿', 'marathi': '🇮🇳',
            'mongolian': '🇲🇳', 'myanmar': '🇲🇲', 'nepali': '🇳🇵', 'norwegian': '🇳🇴',
            'odia': '🇮🇳', 'pashto': '🇦🇫', 'persian': '🇮🇷', 'polish': '🇵🇱',
            'portuguese': '🇵🇹', 'punjabi': '🇮🇳', 'romanian': '🇷🇴', 'russian': '🇷🇺',
            'samoan': '🇼🇸', 'scots': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'serbian': '🇷🇸', 'sesotho': '🇱🇸',
            'shona': '🇿🇼', 'sindhi': '🇵🇰', 'sinhala': '🇱🇰', 'slovak': '🇸🇰',
            'slovenian': '🇸🇮', 'somali': '🇸🇴', 'spanish': '🇪🇸', 'sundanese': '🇮🇩',
            'swahili': '🇰🇪', 'swedish': '🇸🇪', 'tajik': '🇹🇯', 'tamil': '🇮🇳',
            'telugu': '🇮🇳', 'thai': '🇹🇭', 'turkish': '🇹🇷', 'ukrainian': '🇺🇦',
            'urdu': '🇵🇰', 'uyghur': '🇨🇳', 'uzbek': '🇺🇿', 'vietnamese': '🇻🇳',
            'welsh': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'xhosa': '🇿🇦', 'yiddish': '🇮🇱', 'yoruba': '🇳🇬', 'zulu': '🇿🇦'
        }[targetLanguage] || flagEmoji;

        const displayLanguage = getLanguageDisplayName(targetLanguage);

        // Create embed using the same design as auto-translation system - only show translation
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setAuthor({
                name: `${message.author.displayName}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true, size: 128 })
            })
            .addFields({
                name: `${flag} ${displayLanguage}`,
                value: translation.length > 1000 ? translation.substring(0, 997) + '...' : translation,
                inline: false
            })
            .addFields({
                name: '🔍 Info',
                value: `**Original:** [Jump to message](${message.url})`,
                inline: false
            })
            
            .setFooter({
                text: `Auto-deletes in 15 min • Requested by ${user.username}`,
                iconURL: client.user.displayAvatarURL()
            });

        console.log(`📤 Sending flag translation with unified design`);
        const translationReply = await message.reply({
            embeds: [embed],
            allowedMentions: { repliedUser: false }
        });

        // Auto-delete flag translation after 15 minutes
        setTimeout(async () => {
            try {
                await translationReply.delete();
                console.log(`🗑️ Auto-deleted flag translation after 15 minutes`);
            } catch (deleteError) {
                console.log('Could not delete flag translation (message may already be deleted)');
            }
        }, 900000); // 15 minutes

        // Update user-server tracking for vote rewards
        if (!global.userServerTracking) {
            global.userServerTracking = new Map();
        }
        global.userServerTracking.set(user.id, serverId);

        console.log(`✅ Flag translation completed: ${detectedLanguage} -> ${targetLanguage} for user ${user.username}`);

    } catch (error) {
        console.error('❌ Error in flag translation:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack?.split('\n')[0],
            reaction: reaction?.emoji?.name || 'unknown',
            user: user?.username || 'unknown',
            messageId: reaction?.message?.id || 'unknown',
            channelId: reaction?.message?.channel?.id || 'unknown'
        });
        
        try {
            // Try to notify the user about the error via DM
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Translation Error')
                .setDescription('Sorry, there was an error processing your flag translation. Please try again later.')
                .setColor('#e74c3c');

            await user.send({ embeds: [errorEmbed] });
        } catch (dmError) {
            console.log('Could not DM user about translation error');
        }
    }
}

module.exports = messageReactionAdd;
