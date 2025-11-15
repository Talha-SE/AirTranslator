const { ContextMenuCommandBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Personal Buddy • Set Languages')
    .setType(ApplicationCommandType.User)
    .setDMPermission(true),

  async execute(interaction) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('pbSetLangModal')
        .setTitle('Set Personal Buddy Languages');

      const input = new TextInputBuilder()
        .setCustomId('pbLanguages')
        .setLabel('Comma-separated languages (e.g., korean,spanish)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);

      const row = { type: 1, components: [input] };
      modal.addComponents(row);

      await interaction.showModal(modal);
    } catch (e) {
      try { await interaction.reply({ content: '❌ Could not open the languages modal.', flags: MessageFlags.Ephemeral }); } catch {}
    }
  }
};
