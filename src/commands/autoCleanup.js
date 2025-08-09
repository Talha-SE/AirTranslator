const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { updateServerConfig, getServerConfig } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autocleanup')
        .setDescription('Configure auto-cleanup of original messages after translation')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable auto-cleanup')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('delay')
                .setDescription('Delay in seconds before deleting original message (0-300 seconds, 0=immediate)')
                .setMinValue(0)
                .setMaxValue(300)
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Specific channel (leave empty for server-wide)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const serverId = interaction.guild.id;
            const enabled = interaction.options.getBoolean('enabled');
            const delay = interaction.options.getInteger('delay');
            const actualDelay = delay !== null ? delay : 0; // Default to 0 (immediate) if not specified
            const targetChannel = interaction.options.getChannel('channel');

            // Get server configuration
            let serverConfig = await getServerConfig(serverId);
            if (!serverConfig) {
                serverConfig = { serverId: serverId };
            }

            // Initialize autoCleanup object if it doesn't exist
            if (!serverConfig.autoCleanup) {
                serverConfig.autoCleanup = {
                    serverWide: { enabled: false, delay: 30000 },
                    channels: {}
                };
            }

            let configType, configTarget;

            if (targetChannel) {
                // Channel-specific configuration
                configType = 'Channel-specific';
                configTarget = `<#${targetChannel.id}>`;
                
                if (enabled) {
                    serverConfig.autoCleanup.channels[targetChannel.id] = {
                        enabled: true,
                        delay: actualDelay * 1000 // Convert to milliseconds
                    };
                } else {
                    // Remove channel-specific config when disabled
                    delete serverConfig.autoCleanup.channels[targetChannel.id];
                }
            } else {
                // Server-wide configuration
                configType = 'Server-wide';
                configTarget = interaction.guild.name;
                
                serverConfig.autoCleanup.serverWide = {
                    enabled: enabled,
                    delay: enabled ? actualDelay * 1000 : 0 // Convert to milliseconds or 0 if disabled
                };
            }

            // Save the updated configuration
            await updateServerConfig(serverId, serverConfig);

            // Create success embed
            const successEmbed = new EmbedBuilder()
                .setTitle(enabled ? '✅ Auto-Cleanup Enabled' : '❌ Auto-Cleanup Disabled')
                .setDescription(`Auto-cleanup has been **${enabled ? 'enabled' : 'disabled'}** for **${configTarget}**.`)
                .setColor(enabled ? '#28a745' : '#6c757d');

            if (enabled) {
                const delayText = actualDelay === 0 ? 'immediately' : `${actualDelay} seconds`;
                successEmbed.addFields(
                    {
                        name: '⚙️ Configuration',
                        value: `**Type:** ${configType}\n**Delay:** ${delayText}\n**Target:** ${configTarget}`,
                        inline: false
                    },
                    {
                        name: '💡 How it works',
                        value: '• Original messages are deleted after translation\n• Translation messages remain visible\n• Only applies to automatic translations\n• Flag translations have their own 15s auto-delete',
                        inline: false
                    }
                );
            }

            // Show current configuration summary
            const activeConfigs = [];
            
            if (serverConfig.autoCleanup.serverWide?.enabled) {
                const serverDelay = Math.floor(serverConfig.autoCleanup.serverWide.delay / 1000);
                activeConfigs.push(`🌐 **Server-wide:** ${serverDelay}s delay`);
            }
            
            const channelConfigs = Object.entries(serverConfig.autoCleanup.channels || {})
                .filter(([_, config]) => config.enabled)
                .map(([channelId, config]) => {
                    const channelDelay = Math.floor(config.delay / 1000);
                    return `📝 **<#${channelId}>:** ${channelDelay}s delay`;
                });
            
            activeConfigs.push(...channelConfigs);

            if (activeConfigs.length > 0) {
                successEmbed.addFields({
                    name: '� Active Configurations',
                    value: activeConfigs.join('\n') || 'None',
                    inline: false
                });
            }

            successEmbed.addFields({
                name: '🔧 Quick Examples',
                value: '• `/autocleanup enabled:true` - Enable with immediate deletion (0 seconds)\n• `/autocleanup enabled:true delay:15` - Enable server-wide with 15s delay\n• `/autocleanup enabled:true channel:#english delay:10` - Enable for specific channel\n• `/autocleanup enabled:false` - Disable server-wide\n• `/autocleanup enabled:false channel:#english` - Disable for specific channel',
                inline: false
            });

            successEmbed.setFooter({
                text: 'AirTranslator - Auto-Cleanup Management',
                iconURL: interaction.client.user.displayAvatarURL()
            }).setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error in autocleanup command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('There was an error configuring auto-cleanup. Please try again later.')
                .setColor('#e74c3c');

            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};
