const axios = require('axios');
const monetizationService = require('./monetizationService');

class VoteCheckService {
    constructor() {
        this.client = null;
        this.checkedVotes = new Map(); // Store userId -> lastChecked timestamp
        this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
        this.voteCheckTimer = null;
    }

    /**
     * Set the Discord client
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Start the vote checking service
     */
    start() {
        if (this.voteCheckTimer) {
            clearInterval(this.voteCheckTimer);
        }

        console.log('🗳️ Starting Top.gg vote check service...');
        
        // Check immediately, then every 5 minutes
        this.checkRecentVotes();
        this.voteCheckTimer = setInterval(() => {
            this.checkRecentVotes();
        }, this.checkInterval);
    }

    /**
     * Stop the vote checking service
     */
    stop() {
        if (this.voteCheckTimer) {
            clearInterval(this.voteCheckTimer);
            this.voteCheckTimer = null;
            console.log('🛑 Vote check service stopped');
        }
    }

    /**
     * Check for recent votes on Top.gg
     */
    async checkRecentVotes() {
        if (!process.env.TOPGG_TOKEN) {
            console.log('⚠️ No TOPGG_TOKEN found, skipping vote check');
            return;
        }

        try {
            const botId = process.env.CLIENT_ID;
            if (!botId) {
                console.log('⚠️ No CLIENT_ID found, skipping vote check');
                return;
            }

            console.log('🔍 Checking for recent votes on Top.gg...');

            // Get bot votes from Top.gg API
            const response = await axios.get(`https://top.gg/api/bots/${botId}/votes`, {
                headers: {
                    'Authorization': process.env.TOPGG_TOKEN
                },
                params: {
                    onlyids: false // Get full vote data including timestamps
                }
            });

            const votes = response.data;
            console.log(`📊 Found ${votes.length} recent votes to check`);

            let newVotesProcessed = 0;
            const now = Date.now();
            const fiveMinutesAgo = now - (5 * 60 * 1000);

            for (const vote of votes) {
                const userId = vote.id || vote.user;
                const voteTimestamp = new Date(vote.timestamp).getTime();
                
                // Only process votes from the last 5 minutes that we haven't already processed
                const lastChecked = this.checkedVotes.get(userId) || 0;
                
                if (voteTimestamp > fiveMinutesAgo && voteTimestamp > lastChecked) {
                    console.log(`🗳️ Processing new vote from user ${userId}`);
                    
                    // First, check if the vote includes guild information (server-specific vote)
                    let targetServerId = null;
                    
                    if (vote.guild) {
                        // Guild-specific vote - use the guild ID from the vote
                        targetServerId = vote.guild;
                        console.log(`📍 Vote for specific guild: ${targetServerId}`);
                    } else {
                        // Fallback to recent interaction tracking for generic votes
                        targetServerId = global.userServerTracking?.get(userId);
                        if (targetServerId) {
                            console.log(`🔍 Using recent interaction server: ${targetServerId}`);
                        }
                    }
                    
                    if (targetServerId) {
                        // Award 10 bonus translations
                        const result = await monetizationService.handleVoteReward(userId, targetServerId, 10);
                        
                        if (result.success) {
                            console.log(`✅ Vote reward (10 translations) processed for user ${userId} in server ${targetServerId}`);
                            newVotesProcessed++;
                            
                            // Send confirmation message
                            await this.sendVoteConfirmation(userId, targetServerId);
                        }
                        
                        // Update last checked time
                        this.checkedVotes.set(userId, voteTimestamp);
                    } else {
                        console.log(`⚠️ No server found for user ${userId}, skipping vote reward`);
                        // Still mark as checked to avoid reprocessing
                        this.checkedVotes.set(userId, voteTimestamp);
                    }
                }
            }

            if (newVotesProcessed > 0) {
                console.log(`🎉 Processed ${newVotesProcessed} new vote rewards`);
            }

            // Clean up old checked votes (older than 24 hours)
            this.cleanupOldVotes();

        } catch (error) {
            if (error.response?.status === 401) {
                console.error('❌ Top.gg API authentication failed. Check your TOPGG_TOKEN.');
            } else if (error.response?.status === 404) {
                console.error('❌ Bot not found on Top.gg or votes endpoint not available.');
            } else if (error.response?.status >= 500) {
                console.log('⚠️ Top.gg API temporarily unavailable (server error)');
            } else {
                console.log('⚠️ Top.gg API temporarily unavailable:', error.message);
            }
        }
    }

    /**
     * Send vote confirmation message to Discord
     */
    async sendVoteConfirmation(userId, serverId) {
        try {
            if (!this.client) return;

            const guild = this.client.guilds.cache.get(serverId);
            const user = await this.client.users.fetch(userId);

            if (!guild || !user) return;

            // Find a suitable channel
            const channel = guild.channels.cache.find(ch => 
                ch.name.includes('general') || 
                ch.name.includes('chat') ||
                ch.name.includes('main')
            ) || guild.channels.cache.filter(ch => 
                ch.type === 0 && 
                ch.permissionsFor(guild.members.me)?.has('SendMessages')
            ).first();

            if (!channel) return;

            const { EmbedBuilder } = require('discord.js');
            const confirmEmbed = new EmbedBuilder()
                .setTitle('🎉 Vote Reward Received!')
                .setDescription(`Thank you <@${userId}> for voting on Top.gg!\n\n**Your server has received 10 bonus translations!**`)
                .setColor('#28a745')
                .addFields({
                    name: '🗳️ Vote Again',
                    value: 'You can vote again in 12 hours for more rewards!',
                    inline: false
                })
                .setFooter({
                    text: 'AirTranslator - Thank you for your support!',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTimestamp();

            await channel.send({ embeds: [confirmEmbed] });
            console.log(`📨 Vote confirmation sent to ${guild.name} for ${user.tag}`);

        } catch (error) {
            console.error('Error sending vote confirmation:', error);
        }
    }

    /**
     * Clean up old vote records
     */
    cleanupOldVotes() {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        let cleaned = 0;

        for (const [userId, timestamp] of this.checkedVotes.entries()) {
            if (timestamp < oneDayAgo) {
                this.checkedVotes.delete(userId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} old vote records`);
        }
    }
}

module.exports = new VoteCheckService();
