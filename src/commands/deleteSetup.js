const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { getServerSetups, deleteServerSetup } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletesetup')
        .setDescription('Delete a translation setup from MongoDB permanently.')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the setup to delete')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('skip_confirmation')
                .setDescription('Skip the confirmation prompt (use with caution)')
                .setRequired(false)),

    async execute(interaction) {
        const setupName = interaction.options.getString('name');
        const skipConfirmation = interaction.options.getBoolean('skip_confirmation') || false;
        const serverId = interaction.guild.id;

        try {
            // Get all setups for this server
            const server = await getServerSetups(serverId);
            
            if (!server || !server.setups || server.setups.length === 0) {
                return interaction.reply({ 
                    content: '❌ **No Setups Found:** This server doesn\'t have any translation setups. Create one using the `/setup` command first.',
                    ephemeral: true
                });
            }

            // Find the specific setup
            const setup = server.setups.find(s => s.name.toLowerCase() === setupName.toLowerCase());
            
            // If setup not found, show available setups with full details
            if (!setup) {
                const embed = new EmbedBuilder()
                    .setTitle(`❌ Setup Not Found: "${setupName}"`)
                    .setDescription(`Here are the available setups for this server. Please try again with one of these names.`)
                    .setColor(0xFFA500);

                server.setups.forEach((s, index) => {
                    const channelMentions = s.channels.map(channelId => `<#${channelId}>`).join(', ');
                    const languages = s.languages.join(', ');
                    
                    embed.addFields({
                        name: `${index + 1}. ${s.name}`,
                        value: `**Channels:** ${channelMentions}\n**Languages:** ${languages}`,
                        inline: false
                    });
                });
                
                return interaction.reply({
                    content: `No setup named "${setupName}" was found. See available setups below.`,
                    embeds: [embed],
                    ephemeral: true
                });
            }

            // Format channels list for display
            const channelsList = setup.channels.map(id => `<#${id}>`).join(', ');
            
            // If we should skip confirmation, delete immediately
            if (skipConfirmation) {
                await deleteServerSetup(serverId, setupName);
                
                return interaction.reply({
                    content: `✅ **Setup Deleted:** "${setupName}" has been permanently deleted.\n\n**Channels affected:** ${channelsList}`,
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const confirmButton = new ButtonBuilder()
                .setCustomId('confirm_delete')
                .setLabel('Delete Permanently')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_delete')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(cancelButton, confirmButton);

            // Create a detailed embed for the confirmation
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`⚠️ Confirm Setup Deletion`)
                .setDescription(`You are about to **permanently delete** the setup "${setupName}". This action cannot be undone!`)
                .addFields(
                    { name: 'Channels', value: channelsList || 'None', inline: true },
                    { name: 'Languages', value: setup.languages.join(', ') || 'None', inline: true }
                )
                .setFooter({ text: 'This will stop all translations in the affected channels.' });

            const response = await interaction.reply({
                embeds: [embed],
                components: [row],
                ephemeral: true
            });

            // Button interaction collector
            const collectorFilter = i => i.user.id === interaction.user.id;
            
            try {
                const confirmation = await response.awaitMessageComponent({ 
                    filter: collectorFilter,
                    time: 60_000 
                });

                if (confirmation.customId === 'confirm_delete') {
                    await deleteServerSetup(serverId, setupName);
                    await confirmation.update({
                        content: `✅ **Setup Deleted:** "${setupName}" has been permanently deleted.\n\n**Channels affected:** ${channelsList}`,
                        embeds: [],
                        components: []
                    });
                } else if (confirmation.customId === 'cancel_delete') {
                    await confirmation.update({
                        content: '❌ **Deletion Cancelled:** The setup was not deleted.',
                        embeds: [],
                        components: []
                    });
                }
            } catch (err) {
                await interaction.editReply({
                    content: '⚠️ **Confirmation Not Received:** The deletion was cancelled because no response was received within 1 minute.',
                    embeds: [],
                    components: []
                });
            }
        } catch (error) {
            console.error('Error in deleteSetup command:', error);
            await interaction.reply({
                content: '❌ **Error:** An error occurred while trying to delete the setup. Please try again later.',
                ephemeral: true
            });
        }
    }
};
