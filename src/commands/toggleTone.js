const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getSetupsByChannelId, toggleToneUnderstanding } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('toggletone')
        .setDescription('Toggle tone understanding for translations in a channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to enable/disable tone understanding for')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable tone understanding')
                .setRequired(true)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        const enabled = interaction.options.getBoolean('enabled');
        const serverId = interaction.guild.id;

        try {
            // Check if the channel is part of any translation setup
            const setups = await getSetupsByChannelId(serverId, channel.id);
            
            if (!setups || setups.length === 0) {
                return interaction.reply({
                    content: `❌ Channel ${channel} is not part of any translation setup. Add it to a setup first.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Toggle tone understanding for the channel
            const result = await toggleToneUnderstanding(serverId, channel.id, enabled);
            
            if (!result) {
                return interaction.reply({
                    content: '❌ There was an error updating tone understanding settings.',
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Create an embed for the response
            const embed = new EmbedBuilder()
                .setColor(enabled ? 0x00ff00 : 0xff0000)
                .setTitle(`🎭 Tone Understanding ${enabled ? 'Enabled' : 'Disabled'}`)
                .setDescription(`Tone understanding has been ${enabled ? 'enabled' : 'disabled'} for ${channel}.`)
                .addFields(
                    {
                        name: '📝 What This Means',
                        value: enabled ? 
                            'Translations will now preserve tone, emotion, formality, humor, and cultural nuances.' :
                            'Translations will return to standard mode without advanced tone preservation.',
                        inline: false
                    },
                    {
                        name: '💡 Tips',
                        value: enabled ?
                            'Tone understanding works best with longer messages and may use slightly more API resources.' :
                            'Standard translations are efficient and work well for most common communication.',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Server: ${interaction.guild.name}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error toggling tone understanding:', error);
            return interaction.reply({
                content: '❌ There was an error updating tone understanding settings.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};
