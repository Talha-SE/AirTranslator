const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, MessageFlags, ComponentType } = require('discord.js');
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
                    flags: MessageFlags.Ephemeral
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
                    flags: MessageFlags.Ephemeral
                });
            }

            // Format channels list for display
            const channelsList = setup.channels.map(id => `<#${id}>`).join(', ');
            
            // If we should skip confirmation, delete immediately
            if (skipConfirmation) {
                await deleteServerSetup(serverId, setupName);
                
                return interaction.reply({
                    content: `✅ **Setup Deleted:** "${setupName}" has been permanently deleted.\n\n**Channels affected:** ${channelsList}`,
                    flags: MessageFlags.Ephemeral
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
                flags: MessageFlags.Ephemeral
            });

            // Use a collector instead of awaitMessageComponent to handle multiple clicks/race conditions
            const collector = response.createMessageComponentCollector({ 
                componentType: ComponentType.Button, 
                time: 120_000 
            });

            let isProcessing = false;

            collector.on('collect', async (confirmation) => {
                if (confirmation.user.id !== interaction.user.id) {
                    await confirmation.reply({ content: 'Only the person who ran the command can use these buttons.', flags: MessageFlags.Ephemeral });
                    return;
                }

                // If already processing, just defer update to prevent "Interaction failed" errors
                if (isProcessing) {
                    try { await confirmation.deferUpdate(); } catch (e) {}
                    return;
                }

                isProcessing = true;
                collector.stop('processed'); // Stop collecting more interactions

                if (confirmation.customId === 'confirm_delete') {
                    try {
                        // Immediately acknowledge the button press to prevent timeout
                        // We use deferUpdate because it's more robust against race conditions than update
                        await confirmation.deferUpdate();
                        
                        // Then update the UI to show loading state
                        await interaction.editReply({
                            content: `⏳ **Deleting setup "${setupName}"...**`,
                            embeds: [],
                            components: []
                        });
                        
                        try {
                            // Perform the deletion
                            await deleteServerSetup(serverId, setupName);
                            
                            // Final success message
                            await interaction.editReply({
                                content: `✅ **Setup Deleted:** "${setupName}" has been permanently deleted.\n\n**Channels affected:** ${channelsList}`,
                                embeds: [],
                                components: []
                            });
                        } catch (deleteError) {
                            console.error('Database deletion failed:', deleteError);
                            await interaction.editReply({
                                content: '❌ **Error:** Failed to delete setup from database. Please try again.',
                                embeds: [],
                                components: []
                            });
                        }
                    } catch (err) {
                        // If deferUpdate fails (e.g. unknown interaction), try to editReply directly as fallback
                        console.error('Error acknowledging deletion:', err);
                        try {
                            // Only try to show loading if we haven't already
                            await interaction.editReply({
                                content: `⏳ **Deleting setup "${setupName}"...**`,
                                embeds: [],
                                components: []
                            });
                            
                            // Continue with deletion even if acknowledgement failed (the user clicked it!)
                            await deleteServerSetup(serverId, setupName);
                            
                            await interaction.editReply({
                                content: `✅ **Setup Deleted:** "${setupName}" has been permanently deleted.\n\n**Channels affected:** ${channelsList}`,
                                embeds: [],
                                components: []
                            });
                        } catch (fallbackError) {
                            console.error('Fallback deletion handling failed:', fallbackError);
                        }
                    }
                } else if (confirmation.customId === 'cancel_delete') {
                    try {
                        await confirmation.deferUpdate();
                        await interaction.editReply({
                            content: '❌ **Deletion Cancelled:** The setup was not deleted.',
                            embeds: [],
                            components: []
                        });
                    } catch (err) {
                        console.error('Error cancelling:', err);
                    }
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && !isProcessing) {
                    try {
                        await interaction.editReply({
                            content: '⚠️ **Confirmation Not Received:** The deletion was cancelled because no response was received within 2 minutes.',
                            embeds: [],
                            components: []
                        });
                    } catch (e) {}
                }
            });

        } catch (error) {
            console.error('Error in deleteSetup command:', error);
            if (interaction.replied || interaction.deferred) {
                try {
                    await interaction.followUp({
                        content: '❌ **Error:** An error occurred while trying to delete the setup.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch (e) {}
            } else {
                try {
                    await interaction.reply({
                        content: '❌ **Error:** An error occurred while trying to delete the setup.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch (e) {}
            }
        }
    }
};
