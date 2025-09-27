const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const { togglePersonalTranslation, getPersonalTranslationSettings } = require('../services/databaseService');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Personal Buddy • Enable')
    .setType(ApplicationCommandType.User)
    .setDMPermission(true),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const current = await getPersonalTranslationSettings(userId);
      const defaultLanguages = current?.targetLanguages?.length ? current.targetLanguages : ['korean', 'spanish', 'english'];

      const ok = await togglePersonalTranslation(userId, true, defaultLanguages);
      if (ok) {
        await interaction.reply({
          content: `✅ Personal Buddy enabled. Target languages: ${defaultLanguages.join(', ')}`,
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({ content: '❌ Failed to enable Personal Buddy. Please try again.', flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      await interaction.reply({ content: '❌ Error enabling Personal Buddy.', flags: MessageFlags.Ephemeral });
    }
  }
};
