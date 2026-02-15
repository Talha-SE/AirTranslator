const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, MessageFlags } = require('discord.js');
const { detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const { getSetupsByChannelId, getServerSetups, getToneSettings, shouldUseThreadTranslation } = require('../services/databaseService');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');

function getLanguageDisplayName(language) {
    if (!language) return 'Unknown';
    return language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Translate Here')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(true),

  /**
   * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply(); // Public reply so everyone sees it

      const targetMessage = interaction.targetMessage;
      const content = targetMessage?.content?.trim();
      
      if (!content) {
        await interaction.editReply({ content: '❌ The selected message has no text content to translate.' });
        return;
      }

      // Determine target languages based on channel/server config
      let targetLanguages = [];
      const serverId = interaction.guildId;
      const channelId = interaction.channelId;

      if (serverId) {
        // Check server-wide first
        const serverSetup = await getServerSetups(serverId);
        if (serverSetup?.serverWideTranslation && serverSetup.serverWideLanguages?.length > 0) {
           targetLanguages = serverSetup.serverWideLanguages;
        } else {
           // Check channel-specific
           const matchingSetups = await getSetupsByChannelId(serverId, channelId);
           if (matchingSetups && matchingSetups.length > 0) {
               targetLanguages = [...new Set(matchingSetups.flatMap(s => s.languages))];
           }
        }
      }

      // Fallback if no configuration found: Translate to English
      if (targetLanguages.length === 0) {
          targetLanguages = ['en'];
      }

      const detectedLanguage = await detectLanguage(content);
      
      // Filter out languages that match source or are 'auto'
      targetLanguages = targetLanguages
        .filter(l => l !== AUTO_DETECT_LANGUAGE && l.toLowerCase() !== detectedLanguage.toLowerCase());

      if (targetLanguages.length === 0) {
        await interaction.editReply({ content: `ℹ️ Message is already in the target language (${getLanguageDisplayName(detectedLanguage)}).` });
        return;
      }

      const toneSettings = await getToneSettings(serverId, channelId);
      const translations = await translateTextToMultipleLanguages(
        content,
        targetLanguages,
        detectedLanguage,
        toneSettings
      );

      if (!translations || Object.keys(translations).length === 0) {
        await interaction.editReply({ content: '⚠️ Translation failed. Please try again.' });
        return;
      }

      // Format response
      const entries = Object.entries(translations);
      const MAX_FIELDS = 25; // Discord limit
      const fields = entries.slice(0, MAX_FIELDS).map(([lang, text]) => ({
          name: getLanguageDisplayName(lang),
          value: text.length > 1024 ? text.substring(0, 1000) + '...' : text,
          inline: false
      }));

      const embed = new EmbedBuilder()
          .setColor('#0ea5e9')
          .setAuthor({
              name: targetMessage.author.displayName || targetMessage.author.username,
              iconURL: targetMessage.author.displayAvatarURL()
          })
          .setDescription(`**Original (${getLanguageDisplayName(detectedLanguage)}):**\n${content.substring(0, 2000)}`)
          .addFields(fields)
          .setFooter({ text: 'Requested via Context Menu' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Translate Here error:', error);
      try {
        await interaction.editReply({ content: '❌ Failed to process translation.' });
      } catch (_) {}
    }
  }
};
