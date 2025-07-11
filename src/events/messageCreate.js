const { getSetupsByChannelId, getToneSettings, updateServerConfig } = require('../services/databaseService');
const { translateText, detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const fastq = require('fastq');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Server = require('../models/Server');

// Global translation queue with controlled concurrency
const translationQueue = fastq.promise(worker, 1000); // High concurrency, effectively no cap

async function worker(task) {
    // No internal rate limiting; process task immediately
    return task();
}

async function translateAndReply(message, languages) {
    try {
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
        const translations = translationQueue.push(async () => {
            const toneSettings = await getToneSettings(message.guild.id, message.channel.id);
            return translateTextToMultipleLanguages(message.content, targetLanguagesArray, detectedLanguage, toneSettings);
        });
        
        // Record analytics for successful translations
        for (const [language, translation] of Object.entries(await translations)) {
            if (translation && translation.length > 0 && translation !== message.content) {
                analyticsService.recordTranslation(detectedLanguage, language, message.channel.id, message.author.id);
                console.log(`✅ Translated to ${language} for message`);
            }
        }
        
        // If we have translations, send them as a single well-formatted message
        if (Object.keys(await translations).length > 0) {
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
            if (Object.keys(await translations).length > 1) {
                content += "```\n";
                for (const [language, translation] of Object.entries(await translations)) {
                    content += `[${language.toUpperCase()}]: ${translation}\n`;
                }
                content += "```";
            } else {
                // For a single translation, keep it simple
                content += `[${Object.keys(await translations)[0].toUpperCase()}]: ${await translations[Object.keys(await translations)[0]]}`;
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
        console.error('Error in translateAndReply:', error);
    }
}

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.trim()) return;

    try {
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
    }
};