const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { createServerSetup, getServerSetups } = require('../services/databaseService');
const { AUTO_DETECT_LANGUAGE } = require('../utils/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quicksetup')
        .setDescription('Quick setup for in-channel translation with auto-language detection')
        .addChannelOption(option => 
            option.setName('channel1')
                .setDescription('First channel for in-channel translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('language1')
                .setDescription('Target language for the first channel')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel2')
                .setDescription('Second channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language2')
                .setDescription('Target language for second channel (optional)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel3')
                .setDescription('Third channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language3')
                .setDescription('Target language for third channel (optional)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel4')
                .setDescription('Fourth channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language4')
                .setDescription('Target language for fourth channel (optional)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel5')
                .setDescription('Fifth channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language5')
                .setDescription('Target language for fifth channel (optional)')
                .setRequired(false))
        .addChannelOption(option => 
            option.setName('channel6')
                .setDescription('Sixth channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option => 
            option.setName('language6')
                .setDescription('Target language for sixth channel (optional)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name for this setup (optional, will auto-generate if not provided)')
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

            // Collect channels and languages
            const channelData = [];
            let hasValidPair = false;

            for (let i = 1; i <= 6; i++) {
                const channel = interaction.options.getChannel(`channel${i}`);
                const language = interaction.options.getString(`language${i}`);
                
                if (channel && language) {
                    // Valid pair found
                    hasValidPair = true;
                    channelData.push({ channel: channel, language: language });
                } else if (channel || language) {
                    // One is provided but not the other
                    return interaction.reply({
                        content: `❌ **Incomplete Pair:** You provided ${channel ? 'a channel' : 'a language'} for option ${i} but not the corresponding ${channel ? 'language' : 'channel'}. Please provide both or neither.`,
                        flags: 64 // Ephemeral
                    });
                }
            }

            if (!hasValidPair) {
                return interaction.reply({
                    content: '❌ **Missing Data:** You must provide at least one channel-language pair.',
                    flags: 64 // Ephemeral
                });
            }

            // Check for duplicate channels
            const channelIds = channelData.map(data => data.channel.id);
            if (new Set(channelIds).size !== channelIds.length) {
                return interaction.reply({
                    content: '❌ **Duplicate Channels:** Each channel can only be specified once. Please use unique channels.',
                    flags: 64 // Ephemeral
                });
            }

            // Check if any of these channels are already in existing setups
            if (existingServer && existingServer.setups) {
                for (const channelObj of channelData) {
                    const existingSetup = existingServer.setups.find(setup => 
                        setup.channels.includes(channelObj.channel.id)
                    );

                    if (existingSetup) {
                        return interaction.reply({
                            content: `❌ **Channel Already Used:** <#${channelObj.channel.id}> is already part of the "${existingSetup.name}" setup. Each channel can only be in one setup at a time.`,
                            flags: 64 // Ephemeral
                        });
                    }
                }
            }

            // For each channel, we need to create a self-contained translation setup
            // with auto-detection for the source language
            const setupChannels = [];
            const setupLanguages = [];

            // For each channel, we add it twice - once for auto-detection (as source) and once for target language
            for (const channelObj of channelData) {
                // Add channel ID twice (for source and target)
                setupChannels.push(channelObj.channel.id);
                setupChannels.push(channelObj.channel.id);
                
                // Add "auto" for source and the specified language for target
                setupLanguages.push(AUTO_DETECT_LANGUAGE);
                setupLanguages.push(channelObj.language);
            }

            // Create the setup in the database
            const result = await createServerSetup(
                serverId,
                serverName,
                setupName,
                setupChannels,
                setupLanguages
            );

            // Create a visual representation for the user
            const channelConfigurations = channelData.map((data, index) => {
                return `${index + 1}️⃣ <#${data.channel.id}> → 🔤 **${data.language}**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('🚀 Quick Translation Setup Complete!')
                .setDescription(`Setup **"${setupName}"** is now active with in-channel translation.`)
                .addFields(
                    {
                        name: '📝 How It Works',
                        value: 'Messages will be translated in the same channel they were sent, with the language automatically detected.',
                        inline: false
                    },
                    {
                        name: '🔠 Channel Configurations',
                        value: channelConfigurations || 'No channels configured',
                        inline: false
                    },
                    {
                        name: '💡 Usage Tips',
                        value: '• Original messages are preserved\n• Languages are auto-detected\n• Translations appear in the same channel\n• Use `/deletesetup name:' + setupName + '` to remove this setup',
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
                content: '❌ **Setup Error:** There was an error creating your quick translation setup. Please try again later.',
                flags: 64 // Ephemeral
            });
        }
    }
};
