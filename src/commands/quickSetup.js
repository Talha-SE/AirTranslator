const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { createServerSetup, getServerSetups } = require('../services/databaseService');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quicksetup')
        .setDescription('Setup channels with multiple languages for in-channel translation')
        // REQUIRED options must come first
        .addChannelOption(option => 
            option.setName('channel1')
                .setDescription('First channel for translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('language1')
                .setDescription('First target language')
                .setRequired(true))
        // OPTIONAL options must come after all required ones
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name for this setup (optional, will auto-generate if not provided)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel2')
                .setDescription('Second channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel3')
                .setDescription('Third channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel4')
                .setDescription('Fourth channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel5')
                .setDescription('Fifth channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language2')
                .setDescription('Second target language (optional)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language3')
                .setDescription('Third target language (optional)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language4')
                .setDescription('Fourth target language (optional)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language5')
                .setDescription('Fifth target language (optional)')
                .setRequired(false)),

    async execute(interaction) {
        // Get the server information
        const serverId = interaction.guild.id;
        const serverName = interaction.guild.name;
        
        // Get setup name (or generate one if not provided)
        let setupName = interaction.options.getString('name');
        if (!setupName) {
            setupName = `QuickSetup-${Date.now().toString().substring(9)}`;
        }

        try {
            // Check if the server already has setups with this name
            const existingServer = await getServerSetups(serverId);
            if (existingServer && existingServer.setups) {
                const setupWithSameName = existingServer.setups.find(s => s.name === setupName);
                if (setupWithSameName) {
                    return interaction.reply({
                        content: `❌ **Name Conflict:** A setup named "${setupName}" already exists. Please choose a different name.`,
                        flags: 64 // Ephemeral
                    });
                }
            }

            // Collect all channels
            const channels = [];
            for (let i = 1; i <= 5; i++) {
                const channel = interaction.options.getChannel(`channel${i}`);
                if (channel) {
                    channels.push(channel);
                }
            }

            // Collect all languages
            const languages = [];
            for (let i = 1; i <= 5; i++) {
                const language = interaction.options.getString(`language${i}`);
                if (language) {
                    languages.push(language);
                }
            }

            // Validate we have at least one channel
            if (channels.length === 0) {
                return interaction.reply({
                    content: '❌ **Missing Channel:** You must provide at least one channel for translation.',
                    flags: 64 // Ephemeral
                });
            }

            // Check for duplicate channels
            const channelIds = channels.map(channel => channel.id);
            if (new Set(channelIds).size !== channelIds.length) {
                return interaction.reply({
                    content: '❌ **Duplicate Channels:** Each channel can only be specified once within the same setup. Please use unique channels.',
                    flags: 64 // Ephemeral
                });
            }

            // Check for duplicate languages
            if (new Set(languages.map(lang => lang.toLowerCase())).size !== languages.length) {
                return interaction.reply({
                    content: '❌ **Duplicate Languages:** Each language can only be specified once within the same setup. Please provide unique languages.',
                    flags: 64 // Ephemeral
                });
            }

            // Create database structure
            // For each channel and each language, create pairs in the database
            const setupChannels = [];
            const setupLanguages = [];

            // For each channel, add entries for the channel and AUTO_DETECT
            // plus entries for the channel and each language
            for (const channel of channels) {
                // First entry is for auto-detection
                setupChannels.push(channel.id);
                setupLanguages.push(AUTO_DETECT_LANGUAGE);
                
                // Add entries for each language
                for (const language of languages) {
                    setupChannels.push(channel.id);
                    setupLanguages.push(language);
                }
            }

            // Create the setup in the database
            const result = await createServerSetup(
                serverId,
                serverName,
                setupName,
                setupChannels,
                setupLanguages
            );

            // Format channel list for display
            const channelList = channels.map((channel, index) => {
                const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][index] || '🔹';
                return `${emoji} <#${channel.id}>`;
            }).join('\n');

            // Format language list for display
            const languageList = languages.map((language, index) => {
                const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][index] || '🔹';
                return `${emoji} **${language}**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('🚀 Global Translation Setup Complete!')
                .setDescription(`Setup **"${setupName}"** is now active with in-channel translation to multiple languages.`)
                .addFields(
                    {
                        name: '📝 How It Works',
                        value: 'When a message is sent in any configured channel, it will be auto-detected and translated into ALL configured languages.',
                        inline: false
                    },
                    {
                        name: '📡 Active Channels',
                        value: channelList || 'No channels configured',
                        inline: true
                    },
                    {
                        name: '🌍 Available Languages',
                        value: languageList || 'No languages configured',
                        inline: true
                    },
                    {
                        name: '💡 Usage Tips',
                        value: '• Messages are auto-detected\n• All translations appear in the same channel\n• Each language is clearly marked\n• Use `/deletesetup name:' + setupName + '` to remove this setup',
                        inline: false
                    }
                )
                .setFooter({ text: `Server: ${serverName} • Created: ${new Date().toLocaleString()}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('QuickSetup error:', error);
            
            if (error.message === 'SETUP_NAME_EXISTS') {
                return interaction.reply({ 
                    content: `❌ **Name Conflict:** A setup with the name "${setupName}" already exists. Please choose a different name.`,
                    flags: 64 // Ephemeral
                });
            }
            
            if (error.message === 'SETUP_CONFIG_EXISTS') {
                return interaction.reply({ 
                    content: `❌ **Duplicate Setup:** A setup with identical configuration already exists.`,
                    flags: 64 // Ephemeral
                });
            }
            
            return interaction.reply({ 
                content: '❌ **Setup Error:** There was an error creating your translation setup. Please try again later.',
                flags: 64 // Ephemeral
            });
        }
    }
};
