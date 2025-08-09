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
            const serverName = interaction.guild.name;
            const userId = interaction.user.id;
            const settings = monetizationService.getSettings();
            const serverStats = await monetizationService.getServerStats(serverId);
            
            // Determine server status
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
            const remaining = Math.max(0, serverStats.freeTranslationLimit - serverStats.translationCount);
            
            const embed = new EmbedBuilder()
                .setTitle(`🗳️ Vote Status - ${serverName}`)
                .setColor(statusColor)
                .setDescription(`Get **10 bonus translations** every 12 hours by voting!`)
                .addFields(
                    {
                        name: `${statusEmoji} Current Translation Status`,
                        value: `**Translations Used:** ${serverStats.translationCount}/${serverStats.isExempt ? '∞' : serverStats.freeTranslationLimit}\n**Status:** ${statusText}\n**Progress:** ${progressBar} ${percentage}%`,
                        inline: false
                    }
                );
            
            if (!serverStats.isExempt) {
                embed.addFields(
                    {
                        name: '� Vote Rewards',
                        value: `**Remaining Translations:** ${remaining}\n**Vote Reward:** 10 bonus translations\n**Vote Cooldown:** Every 12 hours\n**Automatic:** Rewards credited instantly!`,
                        inline: false
                    },
                    {
                        name: '📋 How to Vote',
                        value: '1️⃣ Click the **Vote on Top.gg** button below\n2️⃣ Complete the voting process on Top.gg\n3️⃣ Get 10 bonus translations within 5 minutes!\n4️⃣ No manual claiming needed - it\'s automatic!',
                        inline: false
                    }
                );
            } else {
                embed.addFields({
                    name: '💎 Premium Status',
                    value: 'You have unlimited translations! Voting helps support the bot and keeps it running for everyone.',
                    inline: false
                });
            }
            
            embed.addFields({
                name: '📋 Available Commands',
                value: '• `/quicksetup` - Quick translation setup\n• `/votestatus` - Check vote status (this command)\n• `/help` - Get help and command list',
                inline: false
            });
            
            embed.setFooter({
                text: 'AirTranslator - Thank you for your support!',
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
