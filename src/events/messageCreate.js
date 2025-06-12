const { getSetupsByChannelId, getToneSettings } = require('../services/databaseService');
const { translateText, detectLanguage } = require('../services/mistralService');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.trim()) return; // Skip empty messages

    try {
        // Find ALL setups that include this channel
        const matchingSetups = await getSetupsByChannelId(message.guild.id, message.channel.id);
        if (!matchingSetups || matchingSetups.length === 0) return;

        // Skip if not enough content to translate
        if (!message.content || message.content.length < 2) return;
        
        // Skip very long messages to prevent API abuse
        if (message.content.length > 1000) {
            console.log(`Skipping very long message (${message.content.length} chars)`);
            return;
        }
        
        // Check if tone understanding is enabled for this channel
        const toneEnabled = await getToneSettings(message.guild.id, message.channel.id);
        
        // Detect the language only once for efficiency
        const detectedLanguage = await detectLanguage(message.content);
        console.log(`Detected language: ${detectedLanguage} for message: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`);

        // Track languages we've already translated to in this channel to avoid duplicates
        const alreadyTranslatedTo = new Set();
        
        // Collect all translations before sending
        const translations = [];
        
        // Process each setup that includes this channel
        for (const setup of matchingSetups) {
            // Get all occurrences of this channel in the setup
            const channelIndices = setup.channels.reduce((indices, channelId, index) => {
                if (channelId === message.channel.id) {
                    indices.push(index);
                }
                return indices;
            }, []);
            
            // If no indices found, skip this setup
            if (channelIndices.length === 0) continue;
            
            // Find the unique languages for this channel in this setup
            const uniqueLanguages = new Set();
            for (const index of channelIndices) {
                const language = setup.languages[index];
                if (language !== AUTO_DETECT_LANGUAGE) {
                    uniqueLanguages.add(language);
                }
            }
            
            // Convert Set to Array for easier processing
            const targetLanguages = Array.from(uniqueLanguages);
            
            // Translate for each target language
            for (const language of targetLanguages) {
                // Skip if the detected language matches the target language
                if (detectedLanguage.toLowerCase() === language.toLowerCase()) {
                    continue;
                }
                
                // Skip if we've already translated to this language from another setup
                if (alreadyTranslatedTo.has(language.toLowerCase())) {
                    console.log(`Skipping duplicate translation to ${language} for setup ${setup.name}`);
                    continue;
                }
                
                // Mark this language as translated
                alreadyTranslatedTo.add(language.toLowerCase());
                
                try {
                    // Translate the message with tone understanding if enabled
                    const translation = await translateText(message.content, language, detectedLanguage, toneEnabled);
                    
                    // Additional validation for translation quality
                    if (translation && translation.length > 0 && translation !== message.content) {
                        // Record translation analytics
                        analyticsService.recordTranslation(detectedLanguage, language, message.channel.id, message.author.id);
                        
                        // Add to our collection of translations
                        translations.push({
                            language: language,
                            text: translation,
                            toneEnabled: toneEnabled
                        });
                        
                        console.log(`✅ Translated to ${language} for setup ${setup.name}${toneEnabled ? ' with tone understanding' : ''}`);
                    } else {
                        console.log(`⚠️ Translation to ${language} was empty or same as original`);
                    }
                } catch (translationError) {
                    console.error(`❌ Translation error for ${language}:`, translationError.message);
                    // Continue with other languages even if one fails
                }
            }
        }
        
        // If we have translations, send them as a single well-formatted message
        if (translations.length > 0) {
            // Format the translations in a clean, organized way
            let content = `**${message.author.displayName}**\n`;
            
            // Add a divider if there are multiple translations
            if (translations.length > 1) {
                content += "```\n";
                for (const translation of translations) {
                    content += `[${translation.language.toUpperCase()}${translation.toneEnabled ? ' 🎭' : ''}]: ${translation.text}\n`;
                }
                content += "```";
            } else {
                // For a single translation, keep it simple
                content += `[${translations[0].language.toUpperCase()}${translations[0].toneEnabled ? ' 🎭' : ''}]: ${translations[0].text}`;
            }
            
            // Ensure the reply isn't too long for Discord
            if (content.length > 2000) {
                content = content.substring(0, 1950) + '\n... (truncated)';
            }
            
            // Send as a single reply
            await message.reply({
                content: content,
                allowedMentions: { repliedUser: false }
            });
        }
    } catch (error) {
        console.error('Error in messageCreate event:', error);
        // Don't send error messages to users to avoid spam
    }
};