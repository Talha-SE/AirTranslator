const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { toggleTranslationStyle, getServer } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('style')
        .setDescription('Configure translation display style (thread-based or text-based)')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Choose translation display style')
                .setRequired(true)
                .addChoices(
                    { name: 'Thread-based - Translations appear in threads', value: 'thread' },
                    { name: 'Text-based - Translations appear as messages (current)', value: 'text' }
                ))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Apply style to specific channel (leave empty for server-wide)')
                .setRequired(false)),

    async execute(interaction) {
        // Check permissions
        if (!interaction.member.permissions.has('ManageMessages')) {
            return interaction.reply({
                content: '❌ You need the `Manage Messages` permission to configure translation styles.',
                flags: MessageFlags.Ephemeral
            });
        }

        const styleType = interaction.options.getString('type');
        const targetChannel = interaction.options.getChannel('channel');
        const serverId = interaction.guild.id;
        const channelId = targetChannel ? targetChannel.id : null;
        const isThreadBased = styleType === 'thread';

        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply();
            }

            // Update the translation style setting
            const result = await toggleTranslationStyle(serverId, channelId, isThreadBased);
            
            if (!result) {
                return interaction.editReply({
                    content: '❌ Failed to update translation style settings. Please try again.'
                });
            }

            // Get current server settings to show updated configuration
            const serverSettings = await getServer(serverId);
            
            // Create response embed
            const embed = new EmbedBuilder()
                .setTitle('🎨 Translation Style Updated')
                .setColor(isThreadBased ? '#10b981' : '#3b82f6')
                .setDescription(`Translation style has been successfully updated!`)
                .addFields(
                    {
                        name: '🎯 Applied To',
                        value: targetChannel ? `**Channel:** ${targetChannel}` : '**Scope:** Server-wide',
                        inline: true
                    },
                    {
                        name: '🎨 Style Type',
                        value: isThreadBased ? 
                            '🧵 **Thread-based**\nTranslations appear in organized threads' : 
                            '💬 **Text-based**\nTranslations appear as regular messages',
                        inline: true
                    }
                );

            // Add explanation of the selected style
            if (isThreadBased) {
                embed.addFields({
                    name: '🧵 Thread-based Translation',
                    value: '• **Organized:** Each translation creates/uses a thread\n• **Clean:** Keeps main channel uncluttered\n• **Contextual:** Groups related translations together\n• **Thread naming:** Uses format "Translation: [Language]"\n• **Perfect for:** Busy channels with lots of translations',
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '💬 Text-based Translation',
                    value: '• **Direct:** Translations appear immediately in channel\n• **Traditional:** The classic translation method\n• **Instant:** No need to check threads\n• **Simple:** Straightforward display\n• **Perfect for:** Quiet channels or immediate responses',
                    inline: false
                });
            }

            // Show current server configuration summary
            const threadChannels = serverSettings.threadStyleChannels || [];
            const hasServerWideThread = serverSettings.threadStyleEnabled || false;
            
            embed.addFields({
                name: '📊 Current Configuration',
                value: hasServerWideThread ? 
                    `**Server-wide:** Thread-based\n**Channel overrides:** ${threadChannels.length} channels` :
                    `**Server-wide:** Text-based\n**Thread channels:** ${threadChannels.length} specific channels`,
                inline: false
            });

            embed.addFields({
                name: '💡 Pro Tips',
                value: '• Mix styles: Set server-wide default and override specific channels\n• Use `/style type:thread` for server-wide thread style\n• Use `/style type:text channel:#general` for channel-specific text style\n• Thread style works best with auto-translation setups',
                inline: false
            });

            embed.setFooter({
                text: 'Translation Style System • AirTranslator',
                iconURL: interaction.client.user.displayAvatarURL()
            }).setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in style command:', error);
            
            try {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setDescription('There was an error updating the translation style. Please try again later.')
                    .setColor('#ef4444');

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ embeds: [errorEmbed] });
                } else {
                    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                console.error('Failed to send error reply in style command:', replyError);
            }
        }
    }
};
