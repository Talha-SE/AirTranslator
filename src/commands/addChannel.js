const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { getServerSetups, updateServerConfig } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addchannel')
        .setDescription('Add a channel to an existing translation setup.')
        .addStringOption(option =>
            option.setName('setup')
                .setDescription('The name of the setup to add the channel to')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to add for translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('language')
                .setDescription('The language for this channel')
                .setRequired(true)),

    async execute(interaction) {
        const setupName = interaction.options.getString('setup');
        const channel = interaction.options.getChannel('channel');
        const language = interaction.options.getString('language');
        const serverId = interaction.guild.id;

        try {
            // Get server setups
            const server = await getServerSetups(serverId);
            
            if (!server || !server.setups || server.setups.length === 0) {
                return interaction.reply({ 
                    content: 'No translation setups found for this server. Use `/setup` to create one first.',
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

            // Check if channel is already in this setup
            if (setup.channels.includes(channel.id)) {
                return interaction.reply({ 
                    content: `Channel ${channel} is already part of the "${setupName}" setup.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Check if channel is used in any other setup
            const channelInOtherSetup = server.setups.find(s => 
                s.name !== setupName && s.channels.includes(channel.id)
            );
            
            if (channelInOtherSetup) {
                return interaction.reply({ 
                    content: `Channel ${channel} is already used in setup "${channelInOtherSetup.name}". A channel can only be in one setup at a time.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Add channel and language to the setup
            setup.channels.push(channel.id);
            setup.languages.push(language);

            // Update the server in database
            await server.save();

            return interaction.reply({
                content: `✅ Channel ${channel} (${language}) has been added to setup "${setupName}".`
            });

        } catch (error) {
            console.error('Error adding channel:', error);
            return interaction.reply({ 
                content: 'There was an error adding the channel. Please try again later.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};