const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const monetizationService = require('../services/monetizationService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Vote for AirTranslator and get bonus translations for your server!'),
    
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const serverId = interaction.guild.id;
            const settings = monetizationService.getSettings();
            const serverStats = await monetizationService.getServerStats(serverId);
            
            const embed = new EmbedBuilder()
                .setTitle('🗳️ Vote for AirTranslator')
                .setColor('#667eea')
                .setDescription('Support AirTranslator by voting on Top.gg and get **50 bonus translations** for your server!')
                .addFields(
                    {
                        name: '📊 Current Server Status',
                        value: `**Translations Used:** ${serverStats.translationCount}/${settings.freeTranslationLimit}\\n**Status:** ${serverStats.canTranslate ? '✅ Active' : '🚫 Limit Reached'}`,
                        inline: true
                    },
                    {
                        name: '🎁 Vote Rewards',
                        value: '• 50 bonus translations\\n• Instant activation\\n• Vote every 12 hours',
                        inline: true
                    },
                    {
                        name: '❓ How it works',
                        value: '1. Click the vote button below\\n2. Vote on Top.gg\\n3. Return and use `/voteclaim` to claim your reward\\n4. Enjoy 50 bonus translations!',
                        inline: false
                    }
                )
                .setFooter({
                    text: 'Thank you for supporting AirTranslator!',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();
            
            const voteButton = new ButtonBuilder()
                .setLabel('🗳️ Vote on Top.gg')
                .setStyle(ButtonStyle.Link)
                .setURL('https://top.gg/bot/1380177061032759416/vote');
            
            const claimButton = new ButtonBuilder()
                .setCustomId('vote_claim')
                .setLabel('🎁 Claim Vote Reward')
                .setStyle(ButtonStyle.Success);
            
            const row = new ActionRowBuilder()
                .addComponents(voteButton, claimButton);
            
            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
            
        } catch (error) {
            console.error('Error in vote command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('There was an error processing your request. Please try again later.')
                .setColor('#e74c3c');
            
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};
