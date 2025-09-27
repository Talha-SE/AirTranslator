const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, MessageFlags } = require('discord.js');
const { detectLanguage, translateTextToMultipleLanguages } = require('../services/mistralService');
const { getPersonalTranslationSettings, recordPersonalTranslation } = require('../services/databaseService');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Translate to My DMs')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(true),

  /**
   * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const settings = await getPersonalTranslationSettings(userId);

      if (!settings || !settings.enabled || !Array.isArray(settings.targetLanguages) || settings.targetLanguages.length === 0) {
        await interaction.reply({
          content: '⚠️ Personal Buddy is not enabled or has no target languages. Use `/personalbuddy enabled:true languages:"korean,spanish"` to enable it.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetMessage = interaction.targetMessage;
      const content = targetMessage?.content?.trim();
      if (!content) {
        await interaction.reply({ content: '❌ The selected message has no text content to translate.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const detectedLanguage = await detectLanguage(content);
      const targetLanguages = settings.targetLanguages
        .filter(l => typeof l === 'string' && l.trim().length > 0)
        .map(l => l.trim())
        .filter(l => l.toLowerCase() !== detectedLanguage.toLowerCase());

      if (targetLanguages.length === 0) {
        await interaction.editReply({ content: 'ℹ️ Your target languages match the source. Nothing to translate.' });
        return;
      }

      const translations = await translateTextToMultipleLanguages(
        content,
        targetLanguages,
        detectedLanguage,
        interaction.inGuild() ? false : false // tone not relevant for quick personal action
      );

      if (!translations || Object.keys(translations).length === 0) {
        await interaction.editReply({ content: '⚠️ No translation output. Please try again.' });
        return;
      }

      const entries = Object.entries(translations);
      const MAX_FIELDS_PER_EMBED = 6;
      for (let i = 0; i < entries.length; i += MAX_FIELDS_PER_EMBED) {
        const slice = entries.slice(i, i + MAX_FIELDS_PER_EMBED);
        const fields = slice.map(([language, translation]) => ({
          name: language.charAt(0).toUpperCase() + language.slice(1),
          value: translation.length > 1024 ? translation.substring(0, 1000) + '\n\n— Truncated —' : translation,
          inline: false
        }));

        const where = interaction.inGuild() ? `${interaction.guild?.name || 'Server'} • #${interaction.channel?.name || 'channel'}` : 'Direct Message';
        const embed = new EmbedBuilder()
          .setColor('#0ea5e9')
          .setTitle('📨 Translation to Your DMs')
          .setDescription(`From: ${where}`)
          .addFields(fields)
          .setFooter({ text: 'AirTranslator • Personal Mode' })
          .setTimestamp();

        try {
          await interaction.user.send({ embeds: [embed] });
        } catch (dmErr) {
          await interaction.editReply({ content: '❌ Could not send you a DM. Please enable DMs and try again.' });
          return;
        }
      }

      await recordPersonalTranslation(userId);
      await interaction.editReply({ content: '✅ Translations sent to your DMs.' });
    } catch (error) {
      console.error('Translate to My DMs error:', error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '❌ Failed to process translation. Please try again later.' });
        } else {
          await interaction.reply({ content: '❌ Failed to process translation. Please try again later.', flags: MessageFlags.Ephemeral });
        }
      } catch (_) {}
    }
  }
};
