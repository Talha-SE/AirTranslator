const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const { getPersonalTranslationSettings, getToneSettings, recordPersonalTranslation } = require('../services/databaseService');
const { translateText, detectLanguage } = require('../services/mistralService');
const { getLanguageDisplayName, getLanguageFlag } = require('../utils/flagMapping');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');

const TRANSLATE_MODEL = 'mistral-large-latest';

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Translate')
        .setType(ApplicationCommandType.Message)
        .setContexts(0, 1, 2)    // GUILD=0, BOT_DM=1, PRIVATE_CHANNEL=2
        .setIntegrationTypes(0, 1), // GUILD_INSTALL=0, USER_INSTALL=1

    async execute(interaction) {
        const userId = interaction.user.id;
        const message = interaction.options.getMessage('message');

        try {
            // Check personal buddy settings
            const personalSettings = await getPersonalTranslationSettings(userId);

            if (!personalSettings || !personalSettings.enabled) {
                return interaction.reply({
                    content: '❌ Personal Translation Buddy is not enabled.\n\nEnable it with `/personalbuddy enabled:true languages:korean,spanish` first,\nor react with a flag emoji on any message instead.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Defer the reply — translation may take a moment
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const targetLanguages = personalSettings.languages || ['korean', 'spanish', 'english'];

            // Get message content
            const hasTextContent = message.content && message.content.trim().length > 0;
            if (!hasTextContent) {
                return interaction.editReply({ content: '❌ This message has no text content to translate.' });
            }

            // Detect source language
            const sourceLanguage = await detectLanguage(message.content);

            // Translate to each target language
            const translations = [];
            for (const lang of targetLanguages) {
                const langLower = lang.toLowerCase();
                // Skip if same language
                if (sourceLanguage && langLower === sourceLanguage) continue;
                if (langLower === AUTO_DETECT_LANGUAGE) continue;

                try {
                    const toneSettings = message.guild ? await getToneSettings(message.guild.id, message.channel.id) : false;
                    const translated = await translateText(message.content, langLower, sourceLanguage, toneSettings, undefined, TRANSLATE_MODEL);
                    if (translated && translated.trim()) {
                        translations.push({ lang: langLower, text: translated.trim() });
                    }
                } catch (err) {
                    console.error(`Personal buddy translate error (${lang}):`, err.message);
                }
            }

            if (translations.length === 0) {
                return interaction.editReply({ content: '❌ Could not translate this message. It may already be in your target language(s).' });
            }

            // Build clean translation text (one line per language)
            const translationLines = translations.map(t =>
                `${getLanguageFlag(t.lang)} **${getLanguageDisplayName(t.lang)}**\n${t.text.length > 1500 ? t.text.substring(0, 1497) + '...' : t.text}`
            ).join('\n\n');

            // Send to user's DM (clean message)
            try {
                await interaction.user.send({
                    content: translationLines
                });
                await interaction.editReply({
                    content: `✅ Translation sent to your DMs!`
                });
            } catch (dmErr) {
                // DMs disabled — show in ephemeral reply instead
                console.warn(`Cannot DM ${interaction.user.username}:`, dmErr.message);
                await interaction.editReply({
                    content: translationLines
                });
            }

            // Record translation
            await recordPersonalTranslation(userId);

        } catch (error) {
            console.error('Error in Translate context menu:', error);
            const msg = '❌ There was an error translating this message.';
            if (interaction.deferred) {
                await interaction.editReply({ content: msg }).catch(() => {});
            } else {
                await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    }
};