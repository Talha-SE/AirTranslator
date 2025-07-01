const { getSetupsByChannelId, getToneSettings } = require('../services/databaseService');
const { translateText, detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const fastq = require('fastq');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Global translation queue with controlled concurrency
const translationQueue = fastq.promise(worker, 1000); // High concurrency, effectively no cap

async function worker(task) {
    // No internal rate limiting; process task immediately
    return task();
}

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.trim()) return; // Skip empty messages

    try {
        // Find ALL setups that include this channel
        const matchingSetups = await getSetupsByChannelId(message.guild.id, message.channel.id);
        if (!matchingSetups || matchingSetups.length === 0) return;

        // Skip if content is truly empty (all whitespace)
        if (!message.content) return;
        
        // Check if tone understanding is enabled for this channel
        const toneEnabled = await getToneSettings(message.guild.id, message.channel.id);
        
        // Detect the language only once for efficiency
        const detectedLanguage = await detectLanguage(message.content);
        console.log(`Detected language: ${detectedLanguage} for message: "${message.content.substring(0, 30)}${message.content.length > 30 ? '...' : ''}"`);

        // Track languages we've already translated to in this channel to avoid duplicates
        const alreadyTranslatedTo = new Set();
        
        // Collect all target languages from all setups
        const allTargetLanguages = new Set();
        
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
            for (const index of channelIndices) {
                const language = setup.languages[index];
                if (language !== AUTO_DETECT_LANGUAGE && 
                    language.toLowerCase() !== detectedLanguage.toLowerCase() &&
                    !alreadyTranslatedTo.has(language.toLowerCase())) {
                    allTargetLanguages.add(language);
                    alreadyTranslatedTo.add(language.toLowerCase());
                }
            }
        }
        
        // If no languages to translate to, return early
        if (allTargetLanguages.size === 0) return;
        
        // Process all translations in parallel
        const targetLanguagesArray = Array.from(allTargetLanguages);
        const translations = await translationQueue.push(() => 
            translateTextToMultipleLanguages(message.content, targetLanguagesArray, detectedLanguage, toneEnabled)
        );
        
        // Record analytics for successful translations
        for (const [language, translation] of Object.entries(translations)) {
            if (translation && translation.length > 0 && translation !== message.content) {
                analyticsService.recordTranslation(detectedLanguage, language, message.channel.id, message.author.id);
                console.log(`✅ Translated to ${language} for message`);
            }
        }
        
        // If we have translations, send them as a single well-formatted message
        if (Object.keys(translations).length > 0) {
            // Helper to split long content into Discord-sized chunks
            const splitIntoChunks = (text, chunkSize = 1900) => {
                const lines = text.split('\n');
                const chunks = [];
                let current = '';
                for (const line of lines) {
                    if ((current + '\n' + line).length > chunkSize) {
                        chunks.push(current);
                        current = line;
                    } else {
                        current += (current ? '\n' : '') + line;
                    }
                }
                if (current) chunks.push(current);
                return chunks;
            };

            // Format the translations in a clean, organized way
            let content = `**${message.author.displayName}**\n`;
            
            // Add a divider if there are multiple translations
            if (Object.keys(translations).length > 1) {
                content += "```\n";
                for (const [language, translation] of Object.entries(translations)) {
                    content += `[${language.toUpperCase()}${toneEnabled ? ' 🎭' : ''}]: ${translation}\n`;
                }
                content += "```";
            } else {
                // For a single translation, keep it simple
                content += `[${Object.keys(translations)[0].toUpperCase()}${toneEnabled ? ' 🎭' : ''}]: ${translations[Object.keys(translations)[0]]}`;
            }
            
            // Discord hard limit 4000; keep margin
            const chunks = splitIntoChunks(content, 1900);
            for (let i = 0; i < chunks.length; i++) {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('Vote')
                            .setURL('https://top.gg/bot/1380177061032759416/vote')
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('🗳️')
                    );
                
                const options = {
                    content: chunks[i],
                    components: [row],
                    allowedMentions: { repliedUser: false }
                };
                if (i === 0) {
                    // reply to original message
                    await message.reply(options);
                } else {
                    await message.channel.send(options);
                }
            }
        }
    } catch (error) {
        console.error('Error in messageCreate event:', error);
        // Don't send error messages to users to avoid spam
    }
};