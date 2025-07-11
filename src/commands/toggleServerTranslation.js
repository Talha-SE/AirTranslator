const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { updateServerConfig } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('toggleservertranslation')
        .setDescription('Enable/disable server-wide translation based on existing channel setups')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable server-wide translation')
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
                .setTitle(`Server-wide translation ${enabled ? 'enabled' : 'disabled'}`)
                .setDescription(enabled 
                    ? 'The bot will now automatically translate messages across all channels based on existing translation setups.'
                    : 'Server-wide translation has been disabled. Only configured channel setups will be used.');

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error toggling server-wide translation:', error);
            return interaction.reply({ 
                content: 'There was an error updating the server-wide translation setting. Please try again later.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};
