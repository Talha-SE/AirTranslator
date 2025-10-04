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
                .setDescription('Delay in minutes before deleting original message (0-720 minutes, 0 = immediate)')
                .setMinValue(0)
                .setMaxValue(720)
                .setRequired(true))
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
            const actualDelayMinutes = delay !== null ? delay : 0;
            const actualDelayMs = actualDelayMinutes * 60 * 1000;
            const targetChannel = interaction.options.getChannel('channel');

            // Get server configuration
            let serverConfig = await getServerConfig(serverId);
            if (!serverConfig) {
                serverConfig = { serverId: serverId };
            }

            // Initialize autoCleanup object if it doesn't exist
            if (!serverConfig.autoCleanup) {
                serverConfig.autoCleanup = {
                    serverWide: { enabled: false, delay: 0 },
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
                        delay: actualDelayMs
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
                    delay: enabled ? actualDelayMs : 0
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
                const delayText = actualDelayMinutes === 0 ? 'immediately' : `${actualDelayMinutes} minute${actualDelayMinutes === 1 ? '' : 's'}`;
                successEmbed.addFields(
                    {
                        name: '⚙️ Configuration',
                        value: `**Type:** ${configType}\n**Delay:** ${delayText}\n**Target:** ${configTarget}`,
                        inline: false
                    },
                    {
                        name: '💡 How it works',
                        value: '• Original messages are deleted after translation\n• Translation messages remain visible\n• Only applies to automatic translations\n• Flag translations have their own 1 minute auto-delete',
                        inline: false
                    }
                );
            }

            // Show current configuration summary
            const formatDelay = (minutes) => minutes === 0 ? 'immediate' : `${minutes} minute${minutes === 1 ? '' : 's'}`;
            const activeConfigs = [];

            if (serverConfig.autoCleanup.serverWide?.enabled) {
                const serverDelayMinutes = Math.round(serverConfig.autoCleanup.serverWide.delay / (60 * 1000));
                activeConfigs.push(`🌐 **Server-wide:** ${formatDelay(serverDelayMinutes)}`);
            }

            const channelConfigs = Object.entries(serverConfig.autoCleanup.channels || {})
                .filter(([_, config]) => config.enabled)
                .map(([channelId, config]) => {
                    const channelDelayMinutes = Math.round(config.delay / (60 * 1000));
                    return `📝 **<#${channelId}>:** ${formatDelay(channelDelayMinutes)}`;
                });

            activeConfigs.push(...channelConfigs);

            if (activeConfigs.length > 0) {
                successEmbed.addFields({
                    name: '📋 Active Configurations',
                    value: activeConfigs.join('\n'),
                    inline: false
                });
            }

            successEmbed.addFields({
                name: '🔧 Quick Examples',
                value: '• `/autocleanup enabled:true delay:0` - Enable with immediate deletion\n• `/autocleanup enabled:true delay:15` - Enable server-wide with 15 minute delay\n• `/autocleanup enabled:true channel:#english delay:10` - Enable for specific channel\n• `/autocleanup enabled:false delay:5` - Disable server-wide (delay ignored)\n• `/autocleanup enabled:false channel:#english delay:5` - Disable for specific channel',
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
