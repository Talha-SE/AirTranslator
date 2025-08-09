const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const monetizationService = require('../services/monetizationService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check your server\'s translation status and limits'),
    
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const serverId = interaction.guild.id;
            const settings = monetizationService.getSettings();
            const serverStats = await monetizationService.getServerStats(serverId);
            
            let statusEmoji = '';
            let statusText = '';
            let statusColor = '';
            
            if (serverStats.isExempt) {
                statusEmoji = '💎';
                statusText = 'Premium (Unlimited)';
                statusColor = '#f39c12';
            } else if (!serverStats.canTranslate) {
                statusEmoji = '🚫';
                statusText = 'Limit Reached';
                statusColor = '#e74c3c';
            } else {
                statusEmoji = '✅';
                statusText = 'Active';
                statusColor = '#28a745';
            }
            
            const progressBar = createProgressBar(serverStats.translationCount, serverStats.freeTranslationLimit, 20);
            const percentage = Math.min((serverStats.translationCount / serverStats.freeTranslationLimit) * 100, 100).toFixed(1);
            
            const embed = new EmbedBuilder()
                .setTitle(`${statusEmoji} Translation Status`)
                .setColor(statusColor)
                .setDescription(`Server: **${interaction.guild.name}**`)
                .addFields(
                    {
                        name: '📊 Usage Statistics',
                        value: `**Translations Used:** ${serverStats.translationCount}/${serverStats.isExempt ? '∞' : serverStats.freeTranslationLimit}\\n**Status:** ${statusText}\\n**Progress:** ${progressBar} ${percentage}%`,
                        inline: false
                    }
                );
            
            if (!serverStats.isExempt) {
                const remaining = Math.max(0, serverStats.freeTranslationLimit - serverStats.translationCount);
                embed.addFields({
                    name: '🎯 Get More Translations',
                    value: `**Remaining:** ${remaining} translations\\n\\n💡 **Get 50 more translations:**\\n• Use \`/vote\` to vote on Top.gg\\n• Vote every 12 hours for more rewards!`,
                    inline: false
                });
            }
            
            embed.addFields({
                name: '📋 Commands',
                value: '• `/vote` - Vote and get bonus translations\\n• `/voteclaim` - Claim your vote rewards\\n• `/status` - Check this status again',
                inline: false
            });
            
            embed.setFooter({
                text: 'AirTranslator - Breaking Language Barriers',
                iconURL: interaction.client.user.displayAvatarURL()
            }).setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error in status command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('There was an error retrieving your server status. Please try again later.')
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
