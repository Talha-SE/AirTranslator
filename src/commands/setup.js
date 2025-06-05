const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { createServerSetup } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Creates a new translation setup for the server.')
        .addStringOption(option => 
            option.setName('name')
                .setDescription('A unique name for this translation setup')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel1')
                .setDescription('The first channel for translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel2')
                .setDescription('The second channel for translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('language1')
                .setDescription('The first language for translation (e.g., English, Spanish)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('language2')
                .setDescription('The second language for translation (e.g., Korean, French)')
                .setRequired(true)),
    
    async execute(interaction) {
        const setupName = interaction.options.getString('name');
        const channel1 = interaction.options.getChannel('channel1');
        const channel2 = interaction.options.getChannel('channel2');
        const language1 = interaction.options.getString('language1');
        const language2 = interaction.options.getString('language2');

        const serverId = interaction.guild.id;
        const serverName = interaction.guild.name;

        // Validate that channels are different
        if (channel1.id === channel2.id) {
            return interaction.reply({ 
                content: 'You must select two different channels for translation.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        // Validate that languages are different
        if (language1.toLowerCase() === language2.toLowerCase()) {
            return interaction.reply({ 
                content: 'You must specify two different languages for translation.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        try {
            const result = await createServerSetup(
                serverId, 
                serverName, 
                setupName, 
                [channel1.id, channel2.id], 
                [language1, language2]
            );

            return interaction.reply({
                content: `✅ **Setup "${setupName}" created successfully!**\n` +
                        `📊 Server: ${serverName} (ID: ${result.server.serverUniqueId.slice(0, 8)}...)\n` +
                        `🔄 Translations will occur between:\n` +
                        `• ${channel1} (${language1})\n` +
                        `• ${channel2} (${language2})`
            });

        } catch (error) {
            console.error('Setup error:', error);
            
            if (error.message === 'SETUP_NAME_EXISTS') {
                return interaction.reply({ 
                    content: `❌ A setup with the name "${setupName}" already exists. Please choose a different name.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }
            
            if (error.message === 'SETUP_CONFIG_EXISTS') {
                return interaction.reply({ 
                    content: `❌ A setup with the same channels and languages already exists. Please use different channels or languages.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }
            
            return interaction.reply({ 
                content: '❌ There was an error creating the translation setup. Please try again.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};