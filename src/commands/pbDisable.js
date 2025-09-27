const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const { togglePersonalTranslation } = require('../services/databaseService');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Personal Buddy • Disable')
    .setType(ApplicationCommandType.User)
    .setDMPermission(true),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const ok = await togglePersonalTranslation(userId, false, []);
      if (ok) {
        await interaction.reply({
          content: '🛑 Personal Buddy disabled for your account.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({ content: '❌ Failed to disable Personal Buddy. Please try again.', flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      await interaction.reply({ content: '❌ Error disabling Personal Buddy.', flags: MessageFlags.Ephemeral });
    }
  }
};
