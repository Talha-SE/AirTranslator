const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const monetizationService = require('../services/monetizationService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('votestatus')
        .setDescription('Check your voting status and earn bonus translations'),
    
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const serverId = interaction.guild.id;
            const serverStats = await monetizationService.getServerStats(serverId);
            
            // Determine server status
            let statusEmoji = '';
            let statusColor = '';
            
            if (serverStats.isExempt) {
                statusEmoji = '💎';
                statusColor = '#f39c12';
            } else if (!serverStats.canTranslate) {
                statusEmoji = '🚫';
                statusColor = '#e74c3c';
            } else {
                statusEmoji = '✅';
                statusColor = '#28a745';
            }
            
            const progressBar = createProgressBar(serverStats.translationCount, serverStats.freeTranslationLimit, 20);
            const percentage = Math.min((serverStats.translationCount / serverStats.freeTranslationLimit) * 100, 100).toFixed(1);
            const remaining = Math.max(0, serverStats.freeTranslationLimit - serverStats.translationCount);
            
            const embed = new EmbedBuilder()
                .setTitle(`🗳️ Vote Status`)
                .setColor(statusColor)
                .setDescription(serverStats.isExempt ? '💎 **Premium Server** - Unlimited translations!' : `Vote every 12 hours to get **+30 bonus translations**!`)
                .addFields(
                    {
                        name: `${statusEmoji} Translation Status`,
                        value: `**Used:** ${serverStats.translationCount}/${serverStats.isExempt ? '∞' : serverStats.freeTranslationLimit}\n**Remaining:** ${serverStats.isExempt ? '∞' : remaining}\n${!serverStats.isExempt ? `${progressBar} ${percentage}%` : ''}`,
                        inline: false
                    }
                );
            
            if (!serverStats.isExempt) {
                embed.addFields({
                    name: '🎁 Vote Reward',
                    value: '**+30 translations** every 12 hours\nRewards are automatic & instant!',
                    inline: false
                });
            }
            
            embed.setFooter({
                text: 'Click the button below to vote on Top.gg',
                iconURL: interaction.client.user.displayAvatarURL()
            }).setTimestamp();
            
            // Always include vote button (helps support the bot even for premium users)
            const voteButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Vote on Top.gg')
                    .setEmoji('🗳️')
                    .setURL(`https://top.gg/bot/1380177061032759416/vote?guild=${serverId}`)
                    .setStyle(ButtonStyle.Link)
            );
            
            await interaction.editReply({
                embeds: [embed],
                components: [voteButton]
            });
            
        } catch (error) {
            console.error('Error in vote status command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('There was an error retrieving your vote status. Please try again later.')
                .setColor('#e74c3c');
            
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};

/**
 * Create a visual progress bar
 * @param {number} current - Current value
 * @param {number} max - Maximum value
 * @param {number} length - Length of the progress bar
 * @returns {string} Progress bar string
 */
function createProgressBar(current, max, length = 20) {
    const percentage = Math.min(current / max, 1);
    const filled = Math.round(length * percentage);
    const empty = length - filled;
    
    const fillChar = '█';
    const emptyChar = '░';
    
    return fillChar.repeat(filled) + emptyChar.repeat(empty);
}
