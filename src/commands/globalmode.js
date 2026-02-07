const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { updateServerConfig } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalmode')
        .setDescription('Enable/disable global translation mode across all server channels')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable global translation mode')
                .setRequired(true)),

    async execute(interaction) {
        const enabled = interaction.options.getBoolean('enabled');
        const serverId = interaction.guild.id;

        try {
            // Update server config with new server-wide translation setting
            await updateServerConfig(serverId, {
                serverWideTranslation: enabled,
                // We'll populate languages in message handler based on existing setups
                serverWideLanguages: [] 
            });

            const embed = new EmbedBuilder()
                .setColor(enabled ? 0x00FF00 : 0xFF0000)
                .setTitle(`🌍 Global Translation Mode ${enabled ? 'Enabled' : 'Disabled'}`)
                .setDescription(enabled 
                    ? 'The bot will now automatically translate messages across **all channels** based on your existing translation setups.'
                    : 'Global translation mode has been disabled. Only configured channel setups will be used.');

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error toggling global translation mode:', error);
            const responseMessage = 'There was an error updating the global translation mode. Please try again later.';
            await interaction.editReply({
                content: responseMessage,
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};
