const { EmbedBuilder } = require('discord.js');
const { getFlagLanguage, getLanguageDisplayName } = require('../utils/flagMapping');
const { translateText, detectLanguage, analyzeAndTranslateImage } = require('../services/mistralService');
const { getPersonalTranslationSettings, recordPersonalTranslation } = require('../services/databaseService');
const monetizationService = require('../services/monetizationService');
const analyticsService = require('../services/analyticsService');

async function messageReactionAdd(client, reaction, user) {
    // Ignore bot reactions
    if (user.bot) return;

    try {
        console.log(`🔍 Reaction received from ${user.username}: ${reaction.emoji.name}`);
        
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
        
        console.log(`📝 Message details - Author: ${message.author?.username || 'Unknown'}, Content: "${message.content?.substring(0, 50) || 'No content'}${message.content?.length > 50 ? '...' : ''}"`);
        
        // Check if this is a flag emoji we support
        const targetLanguage = getFlagLanguage(flagEmoji);
        if (!targetLanguage) {
            console.log(`⚠️ Unsupported flag emoji: ${flagEmoji}`);
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

            // Skip if message is from a bot (unless it's the user's own message)
            if (message.author.bot && message.author.id !== user.id) {
                console.log('⚠️ Skipping bot message for personal translation');
                return;
            }

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

                // Use unified translation system
                console.log(`🔄 Personal buddy translating content from ${detectedLanguage} to ${targetLanguage}`);
                const translation = await translateText(contentToTranslate, targetLanguage, detectedLanguage, true); // Use tone understanding
                
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

                // Add message context with better formatting
                personalEmbed.addFields({
                    name: '🏠 Message Source',
                    value: `**🏢 Server:** ${message.guild.name}\n**📢 Channel:** #${message.channel.name}\n**👤 Author:** ${message.author.username}\n**🔗 Link:** [Jump to message](${message.url})`,
                    inline: false
                });

                personalEmbed
                    .setFooter({
                        text: `Personal Translation Buddy • React with any flag emoji for instant translations`,
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

        // Skip if message is from a bot
        if (message.author.bot) {
            console.log('⚠️ Skipping bot message');
            return;
        }

        console.log(`📝 Processing message from ${message.author.username}${hasTextContent ? `: "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}"` : ''}`);

        // Check server monetization limits
        const serverId = message.guild.id;
        const canTranslate = await monetizationService.canTranslate(serverId);
        
        if (!canTranslate) {
            console.log(`❌ Server ${serverId} has reached translation limit`);
            
            // Send ephemeral message to the user who reacted
            try {
                const limitEmbed = new EmbedBuilder()
                    .setTitle('❌ Translation Limit Reached')
                    .setDescription('This server has reached its daily translation limit.\n\n💡 **Get more translations:**\n• Use `/vote` to get the server-specific voting link\n• Vote on Top.gg for 10 bonus translations!')
                    .setColor('#e74c3c')
                    .setFooter({
                        text: 'Vote every 12 hours for more translations!',
                        iconURL: client.user.displayAvatarURL()
                    });

                // Try to DM the user
                await user.send({ embeds: [limitEmbed] });
            } catch (dmError) {
                console.log('Could not DM user about limit');
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

        // Use unified translation system
        console.log(`🔄 Translating content from ${detectedLanguage} to ${targetLanguage} using unified system`);
        const translation = await translateText(contentToTranslate, targetLanguage, detectedLanguage, true); // Use tone understanding
        
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
            'cebuano': '🇵🇭', 'chichewa': '🇲🇼', 'chinese': '🇨🇳', 'corsican': '🇫🇷',
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
            .setColor('#5865F2')
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
                name: '🔍 Translation Info',
                value: `**From:** ${getLanguageDisplayName(detectedLanguage)}\n**Requested by:** <@${user.id}>\n**Original:** [Jump to message](${message.url})`,
                inline: false
            })
            .setTimestamp()
            .setFooter({
                text: 'React with 🏴 flags to translate messages • Auto-deletes in 30s • AirTranslator',
                iconURL: client.user.displayAvatarURL()
            });

        console.log(`📤 Sending flag translation with unified design`);
        const translationReply = await message.reply({
            embeds: [embed],
            allowedMentions: { repliedUser: false }
        });

        // Auto-delete flag translation after 30 seconds
        setTimeout(async () => {
            try {
                await translationReply.delete();
                console.log(`🗑️ Auto-deleted flag translation after 30 seconds`);
            } catch (deleteError) {
                console.log('Could not delete flag translation (message may already be deleted)');
            }
        }, 30000); // 30 seconds

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
