const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const monetizationService = require('../services/monetizationService');
const databaseService = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voteclaim')
        .setDescription('Claim your vote reward after voting on Top.gg'),
    
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const userId = interaction.user.id;
            const serverId = interaction.guild.id;
            
            // Check if user has voted recently (you might want to implement actual vote verification)
            // For now, we'll trust the user and limit claims per user per server
            
            // Get current server stats
            const serverStats = await monetizationService.getServerStats(serverId);
            const VOTE_BONUS = 50;
            
            // Create a simple cooldown system (24 hours)
            const cooldownKey = `vote_claim_${userId}_${serverId}`;
            const lastClaim = global.voteClaims?.get(cooldownKey);
            const now = Date.now();
            const COOLDOWN_HOURS = 12; // Top.gg allows voting every 12 hours
            
            if (!global.voteClaims) {
                global.voteClaims = new Map();
            }
            
            if (lastClaim && (now - lastClaim) < (COOLDOWN_HOURS * 60 * 60 * 1000)) {
                const timeLeft = Math.ceil(((COOLDOWN_HOURS * 60 * 60 * 1000) - (now - lastClaim)) / (60 * 60 * 1000));
                
                const cooldownEmbed = new EmbedBuilder()
                    .setTitle('⏰ Vote Reward Cooldown')
                    .setDescription(`You can claim your next vote reward in **${timeLeft} hours**.\\n\\nYou can vote every 12 hours on Top.gg!`)
                    .setColor('#f39c12')
                    .setFooter({
                        text: 'Thank you for your patience!',
                        iconURL: interaction.client.user.displayAvatarURL()
                    });
                
                await interaction.editReply({ embeds: [cooldownEmbed] });
                return;
            }
            
            try {
                // Grant the vote reward
                const result = await monetizationService.handleVoteReward(userId, serverId);
                
                if (result.success) {
                    // Update cooldown
                    global.voteClaims.set(cooldownKey, now);
                    
                    // Get updated stats
                    const newServerStats = await monetizationService.getServerStats(serverId);
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle('🎉 Vote Reward Claimed!')
                        .setDescription(`Thank you for voting! Your server has been granted **${VOTE_BONUS} bonus translations**.`)
                        .setColor('#28a745')
                        .addFields(
                            {
                                name: '📊 Updated Server Status',
                                value: `**Previous Count:** ${serverStats.translationCount}\\n**New Count:** ${newServerStats.translationCount}\\n**Bonus Applied:** ${VOTE_BONUS} translations`,
                                inline: false
                            },
                            {
                                name: '⏰ Next Vote',
                                value: 'You can vote again in 12 hours on Top.gg!',
                                inline: false
                            }
                        )
                        .setFooter({
                            text: 'Thank you for supporting AirTranslator!',
                            iconURL: interaction.client.user.displayAvatarURL()
                        })
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [successEmbed] });
                    
                    console.log(`✅ Vote reward claimed by ${interaction.user.tag} for server ${interaction.guild.name} (${serverId})`);
                } else {
                    throw new Error(result.error || 'Unknown error');
                }
            } catch (error) {
                console.error('Error processing vote claim:', error);
                
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Error Claiming Reward')
                    .setDescription('There was an error processing your vote reward. Please try again later or contact support.')
                    .setColor('#e74c3c')
                    .setFooter({
                        text: 'If this error persists, please contact our support team.',
                        iconURL: interaction.client.user.displayAvatarURL()
                    });
                
                await interaction.editReply({ embeds: [errorEmbed] });
            }
            
        } catch (error) {
            console.error('Error in voteclaim command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Command Error')
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
