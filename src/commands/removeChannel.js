const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { getServerSetups } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removechannel')
        .setDescription('Remove a channel from a translation setup.')
        .addStringOption(option =>
            option.setName('setup')
                .setDescription('The name of the setup to remove the channel from')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to remove from translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),

    async execute(interaction) {
        const setupName = interaction.options.getString('setup');
        const channel = interaction.options.getChannel('channel');
        const serverId = interaction.guild.id;

        try {
            // Get server setups
            const server = await getServerSetups(serverId);
            
            if (!server || !server.setups || server.setups.length === 0) {
                return interaction.reply({ 
                    content: 'No translation setups found for this server.',
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Find the specific setup
            const setup = server.setups.find(s => s.name === setupName);
            if (!setup) {
                const availableSetups = server.setups.map(s => s.name).join(', ');
                return interaction.reply({ 
                    content: `Setup "${setupName}" not found. Available setups: ${availableSetups}`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Check if channel exists in this setup
            const channelIndex = setup.channels.indexOf(channel.id);
            if (channelIndex === -1) {
                return interaction.reply({ 
                    content: `Channel ${channel} is not part of the "${setupName}" setup.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Check if removing this channel would leave less than 2 channels
            if (setup.channels.length <= 2) {
                return interaction.reply({ 
                    content: `Cannot remove channel. Setup "${setupName}" must have at least 2 channels. Consider deleting the entire setup instead.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Remove channel and corresponding language
            const removedLanguage = setup.languages[channelIndex];
            setup.channels.splice(channelIndex, 1);
            setup.languages.splice(channelIndex, 1);

            // Update the server in database
            await server.save();

            return interaction.reply({
                content: `✅ Channel ${channel} (${removedLanguage}) has been removed from setup "${setupName}".`
            });

        } catch (error) {
            console.error('Error removing channel:', error);
            return interaction.reply({ 
                content: 'There was an error removing the channel. Please try again later.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};