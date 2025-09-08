const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const databaseService = require('../services/databaseService');
const monetizationService = require('../services/monetizationService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Manage premium payment requests')
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List pending premium requests'))
    .addSubcommand(sub => sub
      .setName('approve')
      .setDescription('Approve a premium request and exempt the server')
      .addStringOption(opt => opt
        .setName('request_id')
        .setDescription('The request ID to approve')
        .setRequired(true)
      )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Ensure only admins can run
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this command.', ephemeral: true });
    }

    if (sub === 'list') {
      try {
        await interaction.deferReply({ ephemeral: true });
        const pending = await databaseService.getPendingPremiumRequests(25);
        if (!pending || pending.length === 0) {
          return interaction.editReply({ content: 'No pending premium requests.' });
        }

        const embed = new EmbedBuilder()
          .setTitle('🧾 Pending Premium Requests')
          .setColor('#f39c12')
          .setDescription('Use `/premium approve request_id:<id>` to approve.')
          .addFields(pending.map(req => ({
            name: `${req.serverName} (${req.serverId})`,
            value: `ID: ${req._id}\nRequester: ${req.requesterDisplayName || req.requesterUsername} (${req.requesterUserId})\nCreated: ${new Date(req.createdAt).toLocaleString()}`,
            inline: false
          })))
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (e) {
        console.error('premium list error:', e);
        return interaction.editReply({ content: '❌ Failed to fetch pending requests.' });
      }
    }

    if (sub === 'approve') {
      const requestId = interaction.options.getString('request_id');
      try {
        await interaction.deferReply({ ephemeral: true });
        const updated = await databaseService.approvePremiumRequest(requestId, interaction.user.id);
        if (!updated) {
          return interaction.editReply({ content: '❌ Request not found or failed to approve.' });
        }

        // Exempt the server
        await monetizationService.addExemptServer(updated.serverId);

        return interaction.editReply({
          content: `✅ Approved request ${updated._id}. Server ${updated.serverName} (${updated.serverId}) is now exempted.`
        });
      } catch (e) {
        console.error('premium approve error:', e);
        return interaction.editReply({ content: '❌ Failed to approve request.' });
      }
    }
  }
};
