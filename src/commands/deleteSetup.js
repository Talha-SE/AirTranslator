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
            // Get the setup details first to show what will be deleted
            const server = await getServerSetups(serverId);
            
            if (!server || !server.setups || server.setups.length === 0) {
                return interaction.reply({ 
                    content: '❌ **No Setups Found:** This server doesn\'t have any translation setups. Create one using the `/setup` command first.',
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Find the specific setup
            const setup = server.setups.find(s => s.name === setupName);
            if (!setup) {
                return interaction.reply({ 
                    content: `❌ **Setup Not Found:** There is no setup named "${setupName}" on this server. Use \`/listsetups\` to see available setups.`,
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            // Format channels list for display
            const channelsList = setup.channels.map(id => `<#${id}>`).join(', ');
            
            // If we should skip confirmation, delete immediately
            if (skipConfirmation) {
                const deletedSetup = await deleteServerSetup(serverId, setupName);
                
                // Create a detailed embed for the deletion
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🗑️ Translation Setup Deleted')
                    .setDescription(`Setup **"${setupName}"** has been permanently deleted.`)
                    .addFields(
                        { name: '📊 Deleted Configuration', value: `**Channels:** ${channelsList}\n**Languages:** ${setup.languages.join(', ')}` }
                    )
                    .setFooter({ text: `Deleted at: ${new Date().toISOString()}` })
                    .setTimestamp();
                
                console.log(`Setup "${setupName}" (ID: ${setup.setupId}) deleted from server ${serverId} without confirmation`);
                
                return interaction.reply({ embeds: [embed] });
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

            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            // Create confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('⚠️ Confirm Deletion')
                .setDescription(`Are you sure you want to permanently delete the setup **"${setupName}"**?`)
                .addFields(
                    { name: '📡 Channels', value: channelsList, inline: true },
                    { name: '🌍 Languages', value: setup.languages.join(', '), inline: true },
                    { name: '⚠️ Warning', value: 'This action cannot be undone. All translation configurations for this setup will be permanently removed.' }
                )
                .setFooter({ text: 'This confirmation will expire in 60 seconds' });

            // Send confirmation message
            const message = await interaction.reply({
                embeds: [confirmEmbed],
                components: [row],
                fetchReply: true
            });

            // Create button collector
            const collector = message.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ 
                        content: 'This confirmation is not for you.', 
                        ephemeral: true 
                    });
                }

                if (i.customId === 'confirm_delete') {
                    // Disable buttons
                    confirmButton.setDisabled(true);
                    cancelButton.setDisabled(true);
                    const disabledRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                    try {
                        // Actually delete the setup
                        await deleteServerSetup(serverId, setupName);
                        
                        // Create success embed
                        const successEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('✅ Setup Deleted Successfully')
                            .setDescription(`Setup **"${setupName}"** has been permanently deleted.`)
                            .setFooter({ text: `Deletion completed at: ${new Date().toISOString()}` })
                            .setTimestamp();
                        
                        console.log(`Setup "${setupName}" (ID: ${setup.setupId}) deleted from server ${serverId} after confirmation`);
                        
                        await i.update({ 
                            embeds: [successEmbed], 
                            components: [disabledRow] 
                        });
                    } catch (error) {
                        console.error('MongoDB deletion error:', error);
                        
                        const errorEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Error Deleting Setup')
                            .setDescription(`Failed to delete setup **"${setupName}"**. Please try again later.`)
                            .addFields(
                                { name: '🔍 Error Details', value: `Something went wrong with the deletion process.` }
                            );
                        
                        await i.update({ 
                            embeds: [errorEmbed], 
                            components: [disabledRow] 
                        });
                    }
                } else if (i.customId === 'cancel_delete') {
                    // Disable buttons
                    confirmButton.setDisabled(true);
                    cancelButton.setDisabled(true);
                    const disabledRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
                    
                    const cancelEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('🛑 Deletion Cancelled')
                        .setDescription(`Setup **"${setupName}"** was not deleted. Your configuration is safe.`);
                    
                    await i.update({ 
                        embeds: [cancelEmbed], 
                        components: [disabledRow] 
                    });
                }
            });

            // Handle when the collector times out
            collector.on('end', async collected => {
                if (collected.size === 0) {
                    // No buttons were clicked, disable the components
                    confirmButton.setDisabled(true);
                    cancelButton.setDisabled(true);
                    const disabledRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
                    
                    const timeoutEmbed = new EmbedBuilder()
                        .setColor(0x888888)
                        .setTitle('⏱️ Confirmation Expired')
                        .setDescription(`The deletion confirmation for **"${setupName}"** has expired. No changes were made.`);
                    
                    await interaction.editReply({ 
                        embeds: [timeoutEmbed], 
                        components: [disabledRow] 
                    }).catch(console.error);
                }
            });

        } catch (error) {
            console.error('Setup deletion error:', error);
            
            let errorMessage = 'There was an error processing your request. Please try again later.';
            
            if (error.name === 'MongoNetworkError' || error.name === 'MongooseServerSelectionError') {
                errorMessage = '❌ **Connection Error:** Unable to connect to our servers. Please check your internet connection and try again.';
            } else if (error.name === 'ValidationError') {
                errorMessage = '❌ **Validation Error:** The setup data is invalid. Please contact support if this persists.';
            } else if (error.message === 'SERVER_NOT_FOUND') {
                errorMessage = '❌ **No Setups Found:** This server doesn\'t have any translation setups.';
            } else if (error.message === 'SETUP_NOT_FOUND') {
                errorMessage = `❌ **Setup Not Found:** There is no setup named "${setupName}" on this server.`;
            } else if (error.message === 'DELETE_OPERATION_FAILED') {
                errorMessage = '❌ **Deletion Failed:** Unable to delete the setup. Please try again later.';
            }
            
            return interaction.reply({ 
                content: errorMessage,
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};
