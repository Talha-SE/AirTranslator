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

        // Check for personal translation buddy settings
        const personalSettings = await getPersonalTranslationSettings(user.id);
        if (personalSettings) {
            console.log(`👤 Personal translation buddy active for ${user.username}`);
            
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
                let translation = null;
                let detectedLang = null;

                // Handle text translation
                if (hasTextContent) {
                    detectedLang = await detectLanguage(message.content);
                    console.log(`🔍 Detected language: ${detectedLang}`);
                    
                    // Don't translate if already in target language
                    if (detectedLang !== targetLanguage) {
                        translation = await translateText(message.content, targetLanguage, detectedLang, true); // Use tone understanding for personal translations
                        console.log(`✅ Personal translation completed: ${targetLanguage}`);
                    }
                }

                // Create DM embed
                const personalEmbed = new EmbedBuilder()
                    .setTitle('🤖 Personal Translation Buddy')
                    .setColor('#3498db')
                    .addFields(
                        {
                            name: `📝 Original Message ${detectedLang ? `(${getLanguageDisplayName(detectedLang)})` : ''}`,
                            value: hasTextContent ? `\`\`\`${message.content}\`\`\`` : '_No text content_',
                            inline: false
                        }
                    );

                if (translation && translation !== message.content) {
                    personalEmbed.addFields({
                        name: `🌍 Translation (${getLanguageDisplayName(targetLanguage)}) ${flagEmoji}`,
                        value: `\`\`\`${translation}\`\`\``,
                        inline: false
                    });
                } else if (detectedLang === targetLanguage) {
                    personalEmbed.addFields({
                        name: '💡 Note',
                        value: `This message is already in ${getLanguageDisplayName(targetLanguage)}`,
                        inline: false
                    });
                }

                // Add message context
                personalEmbed.addFields({
                    name: '📍 Message Context',
                    value: `**Server:** ${message.guild.name}\n**Channel:** #${message.channel.name}\n**Author:** ${message.author.username}\n**Jump to message:** [Click here](${message.url})`,
                    inline: false
                });

                personalEmbed
                    .setFooter({
                        text: `Personal Translation Buddy • React with flags for instant translations`,
                        iconURL: client.user.displayAvatarURL()
                    })
                    .setTimestamp();

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

        // Process text content
        let textTranslation = null;
        let detectedLanguage = 'unknown';
        
        if (hasTextContent) {
            // Detect source language
            detectedLanguage = await detectLanguage(message.content);
            console.log(`🔍 Detected text language: ${detectedLanguage}`);

            // Skip if already in target language
            if (detectedLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
                console.log(`⚠️ Text already in ${targetLanguage}, checking for images...`);
            } else {
                // Translate the text
                console.log(`🔄 Translating text from ${detectedLanguage} to ${targetLanguage}`);
                textTranslation = await translateText(message.content, targetLanguage, detectedLanguage);
                
                if (!textTranslation || textTranslation.trim().length === 0) {
                    console.log('❌ Text translation failed or returned empty result');
                    textTranslation = null;
                }
            }
        }

        // Process image attachments
        let imageTranslations = [];
        
        if (imageAttachments.length > 0) {
            console.log(`🖼️ Processing ${imageAttachments.length} image(s) for content analysis and description translation`);
            
            for (let i = 0; i < Math.min(imageAttachments.length, 3); i++) { // Limit to 3 images to avoid rate limits
                const attachment = imageAttachments[i];
                try {
                    console.log(`📸 Analyzing image ${i + 1}/${Math.min(imageAttachments.length, 3)}: ${attachment.name}`);
                    const imageAnalysis = await analyzeAndTranslateImage(attachment.url, targetLanguage);
                    
                    if (imageAnalysis.hasText) {
                        imageTranslations.push({
                            fileName: attachment.name,
                            originalText: imageAnalysis.extractedText,
                            detectedLanguage: imageAnalysis.detectedLanguage,
                            translation: imageAnalysis.translation,
                            confidence: imageAnalysis.confidence
                        });
                        console.log(`✅ Generated description for ${attachment.name}: "${imageAnalysis.extractedText.substring(0, 50)}..."`);
                    } else {
                        console.log(`ℹ️ No content found in ${attachment.name}`);
                    }
                } catch (imageError) {
                    console.error(`❌ Error processing image ${attachment.name}:`, imageError.message);
                    if (imageError.message === 'RATE_LIMITED') {
                        imageTranslations.push({
                            fileName: attachment.name,
                            error: 'Rate limited - please try again later'
                        });
                    }
                }
            }
        }

        // Check if we have anything to show
        const hasTextToShow = textTranslation && textTranslation.trim().length > 0;
        const hasImageTextToShow = imageTranslations.length > 0 && imageTranslations.some(img => img.translation || img.error);

        if (!hasTextToShow && !hasImageTextToShow) {
            if (hasTextContent && detectedLanguage.toLowerCase() === targetLanguage.toLowerCase() && imageAttachments.length === 0) {
                console.log(`⚠️ Message already in ${targetLanguage}, skipping translation`);
                return;
            }
            if (imageAttachments.length > 0 && !hasImageTextToShow) {
                console.log(`ℹ️ No translatable text found in any images`);
                return;
            }
            console.log('❌ No content to translate found');
            return;
        }

        // Update usage count
        await monetizationService.incrementTranslationCount(serverId);
        
        // Track analytics
        if (hasTextToShow) {
            analyticsService.recordTranslation(detectedLanguage, targetLanguage, message.channel.id, user.id);
        } else if (hasImageTextToShow) {
            // Track image translation analytics
            const primaryImageLang = imageTranslations.find(img => img.detectedLanguage)?.detectedLanguage || 'unknown';
            analyticsService.recordTranslation(primaryImageLang, targetLanguage, message.channel.id, user.id);
        }

        // Create translation embed with original design (as shown in user's image)
        const translationEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({
                name: `${message.author.displayName}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true, size: 128 })
            })
            .setTimestamp()
            .setFooter({
                text: 'React with 🏴 flags to translate messages • Auto-deletes in 15s • AirTranslator',
                iconURL: client.user.displayAvatarURL()
            });

        // Handle text content
        if (hasTextToShow) {
            // Set description with original message
            translationEmbed.setDescription(`> ${message.content}`);
            
            // Add main translation field
            translationEmbed.addFields({
                name: `${flagEmoji} ${getLanguageDisplayName(targetLanguage)}`,
                value: textTranslation,
                inline: false
            });

            // Add translation info
            translationEmbed.addFields({
                name: '🔍 Translation Info',
                value: `**From:** ${getLanguageDisplayName(detectedLanguage)}\n**Requested by:** <@${user.id}>\n**Original:** [Jump to message](${message.url})`,
                inline: false
            });
        }

        // Handle image translations if available
        if (hasImageTextToShow) {
            if (!hasTextToShow) {
                // If only images, set a different description
                translationEmbed.setDescription(`> Image text translation requested`);
            }
            
            // Add image translation results
            for (let i = 0; i < Math.min(imageTranslations.length, 2); i++) { // Limit to 2 images to keep clean design
                const imgTranslation = imageTranslations[i];
                
                if (imgTranslation.error) {
                    translationEmbed.addFields({
                        name: `🖼️ ${imgTranslation.fileName}`,
                        value: `⚠️ ${imgTranslation.error}`,
                        inline: false
                    });
                } else if (imgTranslation.translation) {
                    // Add image translation field
                    translationEmbed.addFields({
                        name: `${flagEmoji} ${getLanguageDisplayName(targetLanguage)} (image description)`,
                        value: imgTranslation.translation,
                        inline: false
                    });

                    // Add image translation info
                    if (!hasTextToShow) { // Only add if we don't have text translation info already
                        translationEmbed.addFields({
                            name: '� Translation Info',
                            value: `**From:** ${getLanguageDisplayName(imgTranslation.detectedLanguage || 'detected')}\n**Requested by:** <@${user.id}>\n**Original:** [Jump to message](${message.url})`,
                            inline: false
                        });
                    }
                }
            }

            if (imageTranslations.length > 2) {
                translationEmbed.addFields({
                    name: 'ℹ️ Note',
                    value: `${imageTranslations.length - 2} more images were processed but not shown to keep the design clean.`,
                    inline: false
                });
            }
        }

        console.log(`📤 Sending translation embed with original design`);
        const translationReply = await message.reply({
            embeds: [translationEmbed],
            allowedMentions: { repliedUser: false }
        });

        // Auto-delete flag translation after 15 seconds
        setTimeout(async () => {
            try {
                await translationReply.delete();
                console.log(`🗑️ Auto-deleted flag translation after 15 seconds`);
            } catch (deleteError) {
                console.log('Could not delete flag translation (message may already be deleted)');
            }
        }, 15000); // 15 seconds

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
