const { getSetupByChannelId } = require('../services/databaseService');
const { translateText, detectLanguage } = require('../services/mistralService');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.trim()) return; // Skip empty messages

    try {
        // Find setup that includes this channel
        const setup = await getSetupByChannelId(message.guild.id, message.channel.id);
        if (!setup) return;

        // Get all occurrences of this channel in the setup
        const channelIndices = setup.channels.reduce((indices, channelId, index) => {
            if (channelId === message.channel.id) {
                indices.push(index);
            }
            return indices;
        }, []);
        
        // If no indices found, something's wrong
        if (channelIndices.length === 0) return;
        
        // Get the source language (should be auto-detect)
        const sourceLanguage = setup.languages[channelIndices[0]];
        
        // Skip if not enough content to translate
        if (!message.content || message.content.length < 2) return;
        
        // Check if this is a quickSetup (same channel appears twice consecutively)
        const isQuickSetup = channelIndices.length >= 2 && setup.channels[channelIndices[0]] === setup.channels[channelIndices[1]];
        
        if (isQuickSetup) {
            // This is a quickSetup with in-channel translation
            
            // Detect the language
            const detectedLanguage = await detectLanguage(message.content);
            
            // For each occurrence of this channel (usually 2 for quickSetup)
            for (let i = 0; i < channelIndices.length; i++) {
                const index = channelIndices[i];
                const targetLanguage = setup.languages[index];
                
                // Skip auto-detect entries
                if (targetLanguage === AUTO_DETECT_LANGUAGE) continue;
                
                // Skip if detected language matches target language
                if (detectedLanguage.toLowerCase() === targetLanguage.toLowerCase()) continue;
                
                // Translate the message
                const translation = await translateText(message.content, targetLanguage, detectedLanguage);
                
                // Send translation as a reply to the original message with the new format
                await message.reply({
                    content: `${message.author.displayName}\n[${targetLanguage.toUpperCase()}]: ${translation}`,
                    allowedMentions: { repliedUser: false }
                });
            }
        } else {
            // This is a regular cross-channel setup
            const sourceChannelIndex = setup.channels.indexOf(message.channel.id);
            const sourceLanguage = setup.languages[sourceChannelIndex];
            
            // Detect the language if source is set to auto-detect
            let detectedLanguage = null;
            if (sourceLanguage === AUTO_DETECT_LANGUAGE) {
                detectedLanguage = await detectLanguage(message.content);
            }

            // Process translations for each target channel
            for (let i = 0; i < setup.channels.length; i++) {
                // Skip the source channel - don't translate to itself
                if (i === sourceChannelIndex) continue;
                
                const targetChannelId = setup.channels[i];
                const targetChannel = client.channels.cache.get(targetChannelId);
                
                if (!targetChannel) {
                    console.error(`Target channel ${targetChannelId} not found for setup: ${setup.name}`);
                    continue;
                }

                // Get target language
                const targetLanguage = setup.languages[i];
                
                // Skip if both source and target are "auto"
                if (sourceLanguage === AUTO_DETECT_LANGUAGE && targetLanguage === AUTO_DETECT_LANGUAGE) {
                    continue;
                }
                
                // If target is "auto", display original message
                if (targetLanguage === AUTO_DETECT_LANGUAGE) {
                    await targetChannel.send(`**${message.author.displayName}** *(${setup.name})*: ${message.content}`);
                    continue;
                }
                
                // Use detected language if source is auto-detect
                const actualSourceLang = sourceLanguage === AUTO_DETECT_LANGUAGE ? detectedLanguage : sourceLanguage;
                
                // Skip if target language is the same as the detected/source language
                if (actualSourceLang === targetLanguage) {
                    await targetChannel.send(`**${message.author.displayName}** *(${setup.name})*: ${message.content}`);
                    continue;
                }
                
                // Translate the message
                const translation = await translateText(message.content, targetLanguage, actualSourceLang);
                
                // Send translation with setup info - updated format for cross-channel too
                await targetChannel.send(`**${message.author.displayName}**\n[${targetLanguage.toUpperCase()}]: ${translation}`);
            }
        }
    } catch (error) {
        console.error('Error in messageCreate event:', error);
    }
};