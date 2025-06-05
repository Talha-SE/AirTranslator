const { SlashCommandBuilder } = require('discord.js');
const { deleteServerSetup } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletesetup')
        .setDescription('Delete a translation setup.')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the setup to delete')
                .setRequired(true)),

    async execute(interaction) {
        const setupName = interaction.options.getString('name');
        const serverId = interaction.guild.id;

        try {
            await deleteServerSetup(serverId, setupName);
            
            return interaction.reply({
                content: `✅ Setup "${setupName}" has been deleted successfully.`
            });

        } catch (error) {
            console.error('Error deleting setup:', error);
            
            if (error.message === 'SERVER_NOT_FOUND') {
                return interaction.reply({ 
                    content: 'No translation setups found for this server.',
                    flags: 64 // MessageFlags.Ephemeral
                });
            }
            
            if (error.message === 'SETUP_NOT_FOUND') {
                return interaction.reply({ 
                    content: `Setup "${setupName}" not found.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }
            
            return interaction.reply({ 
                content: 'There was an error deleting the setup. Please try again later.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};
