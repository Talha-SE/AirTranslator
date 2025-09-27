const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autosetup')
        .setDescription('Guided setup: select channels and languages to auto-create a translation setup'),

    async execute(interaction) {
        try {
            if (!interaction.inGuild()) {
                await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
                return;
            }

            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('autosetup_channels')
                .setPlaceholder('Select 1-5 channels for translation')
                .setMinValues(1)
                .setMaxValues(5)
                .setChannelTypes([ChannelType.GuildText, ChannelType.GuildVoice]);

            const controlsRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('autosetup_continue').setLabel('Continue ▶').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('autosetup_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );

            const selectRow = new ActionRowBuilder().addComponents(channelSelect);

            await interaction.reply({
                content: 'Start guided auto setup below:',
                components: [selectRow, controlsRow],
                ephemeral: true
            });
        } catch (err) {
            try {
                await interaction.reply({ content: '❌ Failed to start auto setup. Please try again.', ephemeral: true });
            } catch {}
        }
    }
};
