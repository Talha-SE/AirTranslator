const { getSetupsByChannelId, getToneSettings } = require('../services/databaseService');
const { translateText, detectLanguage } = require('../services/mistralService');
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
            
            // Collect translation promises for each target language
            const translationTasks = [];
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
                    // Queue translation promise but don't await yet
                    const promise = translationQueue.push(() => translateText(message.content, language, detectedLanguage, toneEnabled))
                        .then(translation => ({ language, translation }));
                    translationTasks.push(promise);
                } catch (translationError) {
                    console.error(`❌ Translation error for ${language}:`, translationError.message);
                    // Continue with other languages even if one fails
                }
            }
            // Wait for all queued translations for this setup
            const results = await Promise.allSettled(translationTasks);
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    const { language, translation } = result.value;
                    if (translation && translation.length > 0 && translation !== message.content) {
                        analyticsService.recordTranslation(detectedLanguage, language, message.channel.id, message.author.id);
                        translations.push({ language, text: translation, toneEnabled });
                        console.log(`✅ Translated to ${language} for setup ${setup.name}${toneEnabled ? ' with tone understanding' : ''}`);
                    }
                } else {
                    console.error(`❌ Translation error for ${language}:`, result.reason?.message || result.reason);
                }
            }
        }
        
        // If we have translations, send them as a single well-formatted message
        if (translations.length > 0) {
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