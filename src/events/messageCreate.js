const { getSetupsByChannelId, getToneSettings, updateServerConfig } = require('../services/databaseService');
const { translateText, detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const fastq = require('fastq');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const analyticsService = require('../services/analyticsService');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
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
            // Format the translations in a blue embed like help command
            const embed = new EmbedBuilder()
                .setColor(0x3498db) // Clear blue color
                .setAuthor({
                    name: `${message.author.displayName}'s Translations`,
                    iconURL: message.author.displayAvatarURL()
                });

            // Add translations with language flags
            const languageFlags = {
                'afrikaans': '🇿🇦',
                'albanian': '🇦🇱',
                'amharic': '🇪🇹',
                'arabic': '🇸🇦',
                'armenian': '🇦🇲',
                'azerbaijani': '🇦🇿',
                'basque': '🇪🇸',
                'belarusian': '🇧🇾',
                'bengali': '🇧🇩',
                'bosnian': '🇧🇦',
                'bulgarian': '🇧🇬',
                'burmese': '🇲🇲',
                'catalan': '🇪🇸',
                'cebuano': '🇵🇭',
                'chinese': '🇨🇳',
                'corsican': '🇫🇷',
                'croatian': '🇭🇷',
                'czech': '🇨🇿',
                'danish': '🇩🇰',
                'dutch': '🇳🇱',
                'english': '🇬🇧',
                'esperanto': '🏳️',
                'estonian': '🇪🇪',
                'filipino': '🇵🇭',
                'finnish': '🇫🇮',
                'french': '🇫🇷',
                'frisian': '🇳🇱',
                'galician': '🇪🇸',
                'georgian': '🇬🇪',
                'german': '🇩🇪',
                'greek': '🇬🇷',
                'gujarati': '🇮🇳',
                'haitian': '🇭🇹',
                'hausa': '🇳🇬',
                'hawaiian': '🇺🇸',
                'hebrew': '🇮🇱',
                'hindi': '🇮🇳',
                'hmong': '🇨🇳',
                'hungarian': '🇭🇺',
                'icelandic': '🇮🇸',
                'igbo': '🇳🇬',
                'indonesian': '🇮🇩',
                'irish': '🇮🇪',
                'italian': '🇮🇹',
                'japanese': '🇯🇵',
                'javanese': '🇮🇩',
                'kannada': '🇮🇳',
                'kazakh': '🇰🇿',
                'khmer': '🇰🇭',
                'kinyarwanda': '🇷🇼',
                'korean': '🇰🇷',
                'kurdish': '🇮🇶',
                'kyrgyz': '🇰🇬',
                'lao': '🇱🇦',
                'latin': '🏛️',
                'latvian': '🇱🇻',
                'lithuanian': '🇱🇹',
                'luxembourgish': '🇱🇺',
                'macedonian': '🇲🇰',
                'malagasy': '🇲🇬',
                'malay': '🇲🇾',
                'malayalam': '🇮🇳',
                'maltese': '🇲🇹',
                'maori': '🇳🇿',
                'marathi': '🇮🇳',
                'mongolian': '🇲🇳',
                'nepali': '🇳🇵',
                'norwegian': '🇳🇴',
                'nyanja': '🇲🇼',
                'odia': '🇮🇳',
                'pashto': '🇦🇫',
                'persian': '🇮🇷',
                'polish': '🇵🇱',
                'portuguese': '🇵🇹',
                'punjabi': '🇮🇳',
                'romanian': '🇷🇴',
                'russian': '🇷🇺',
                'samoan': '🇼🇸',
                'scots': '🏴',
                'serbian': '🇷🇸',
                'sesotho': '🇱🇸',
                'shona': '🇿🇼',
                'sindhi': '🇵🇰',
                'sinhala': '🇱🇰',
                'slovak': '🇸🇰',
                'slovenian': '🇸🇮',
                'somali': '🇸🇴',
                'spanish': '🇪🇸',
                'sundanese': '🇮🇩',
                'swahili': '🇰🇪',
                'swedish': '🇸🇪',
                'tagalog': '🇵🇭',
                'tajik': '🇹🇯',
                'tamil': '🇮🇳',
                'tatar': '🇷🇺',
                'telugu': '🇮🇳',
                'thai': '🇹🇭',
                'turkish': '🇹🇷',
                'turkmen': '🇹🇲',
                'ukrainian': '🇺🇦',
                'urdu': '🇵🇰',
                'uyghur': '🇨🇳',
                'uzbek': '🇺🇿',
                'vietnamese': '🇻🇳',
                'welsh': '🏴',
                'xhosa': '🇿🇦',
                'yiddish': '🇮🇱',
                'yoruba': '🇳🇬',
                'zulu': '🇿🇦'
            };

            let translationContent = '```\n';
            for (const [language, translation] of Object.entries(await translations)) {
                const flag = languageFlags[language.toLowerCase()] || '🌐';
                translationContent += `${flag} ${language.toUpperCase()}:  ${translation}\n`;
            }
            translationContent += '```';

            embed.setDescription(translationContent);

            // Send the embed without footer
            await message.reply({
                embeds: [embed],
                allowedMentions: { repliedUser: false }
            });
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