const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ttsvoice')
    .setDescription('[Deprecated] Voice selection moved into /ttssetup')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎙️ Voice Selection Moved')
        .setDescription('Voice selection is now part of the `/ttssetup` flow. Run `/ttssetup` and pick languages; you will see voice menus to choose from immediately.')
        .setFooter({ text: 'Use /ttssetup to configure languages, channels, and voices in one place.' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      console.error('ttsvoice deprecated error:', error);
      return interaction.reply({ content: 'Use `/ttssetup` to configure voices now.', ephemeral: true });
    }
  }
};