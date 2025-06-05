const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { createServerSetup } = require('../services/databaseService');
const { SUPPORTED_LANGUAGES, MIN_CHANNELS_REQUIRED } = require('../utils/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Create a translation setup with auto-language detection')
        // Required options must come first
        .addStringOption(option => 
            option.setName('name')
                .setDescription('A unique name for this translation setup')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel1')
                .setDescription('First channel for translation (source will be auto-detected)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('channel2')
                .setDescription('Second channel for translation')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addStringOption(option => 
            option.setName('language1')
                .setDescription('Target language for translations (e.g., English, Spanish, French)')
                .setRequired(true))
        // Optional options must come after all required ones
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
        .addChannelOption(option =>
            option.setName('channel3')
                .setDescription('Third channel for translation (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel4')
                .setDescription('Fourth channel for translation (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel5')
                .setDescription('Fifth channel for translation (optional)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)),

    async execute(interaction) {
        const setupName = interaction.options.getString('name');
        const serverId = interaction.guild.id;
        const serverName = interaction.guild.name;

        // Collect channels
        const channels = [];
        for (let i = 1; i <= 5; i++) {
            const channel = interaction.options.getChannel(`channel${i}`);
            if (channel) {
                channels.push(channel.id);
            }
        }

        // Collect languages
        const languages = [];
        for (let i = 1; i <= 4; i++) {
            const language = interaction.options.getString(`language${i}`);
            if (language) {
                languages.push(language);
            }
        }

        // Validate that we have at least 2 channels
        if (channels.length < MIN_CHANNELS_REQUIRED) {
            return interaction.reply({ 
                content: `❌ **Channels Error:** You must provide at least ${MIN_CHANNELS_REQUIRED} channels for translation.`,
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        // Validate that we have at least 1 language
        if (languages.length < 1) {
            return interaction.reply({ 
                content: '❌ **Languages Error:** You must provide at least 1 target language for translation.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        // Validate that all channels are different
        const uniqueChannelIds = new Set(channels);
        if (uniqueChannelIds.size !== channels.length) {
            return interaction.reply({ 
                content: '❌ **Channels Error:** All channels must be different within the same setup. Please select unique channels.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        // Validate that all languages are different
        const lowerLanguages = languages.map(lang => lang.toLowerCase());
        const uniqueLanguages = new Set(lowerLanguages);
        if (uniqueLanguages.size !== lowerLanguages.length) {
            return interaction.reply({ 
                content: '❌ **Languages Error:** All languages must be different within the same setup. Please specify unique languages.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        // REMOVE any existing code that prevents channels from being used in multiple setups

        // Special case: If we have more than one channel but only one language,
        // we need to duplicate the language to match the channel count for auto-detection
        if (channels.length > 1 && languages.length === 1) {
            // Add "auto" as the first language (auto-detect)
            const finalLanguages = ["auto"];
            // Then add the single specified language for all other channels
            for (let i = 1; i < channels.length; i++) {
                finalLanguages.push(languages[0]);
            }
            languages.length = 0; // Clear the array
            languages.push(...finalLanguages); // Push all the new values
        } else if (languages.length < channels.length) {
            // If we have fewer languages than channels, add "auto" as the first language
            // and use the provided languages for the remaining channels
            languages.unshift("auto");
        }

        try {
            const result = await createServerSetup(
                serverId, 
                serverName, 
                setupName, 
                channels,
                languages
            );

            // Format channel list for display
            const channelList = channels.map((channelId, index) => {
                const number = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][index];
                return `${number} <#${channelId}>`;
            }).join('\n');

            // Format language list for display
            const languageList = languages.map((lang, index) => {
                const number = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][index];
                const displayLang = lang === "auto" ? "Auto-detect" : lang;
                return `${number} 🌐 **${displayLang}**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x00ff88)
                .setTitle('🎉 Translation Setup Complete!')
                .setDescription(`✅ Setup "${setupName}" is now configured with auto language detection.\n🔍 Messages will be automatically detected and translated to your target language(s).`)
                .addFields(
                    {
                        name: '📡 Configured Channels',
                        value: channelList,
                        inline: true
                    },
                    {
                        name: '🌍 Language Settings',
                        value: languageList,
                        inline: true
                    },
                    {
                        name: '🎯 How It Works',
                        value: '✨ **Auto Detection:** The system will automatically detect the language of each message\n\n🔄 **Smart Translation:** Messages are only translated when needed\n\n👤 **Original Context:** Each translation includes the author\'s name',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Server: ${serverName} • ID: ${result.server.serverUniqueId.slice(0, 8)}...`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });

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