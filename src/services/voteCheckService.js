const axios = require('axios');
const monetizationService = require('./monetizationService');
const databaseService = require('./databaseService');

class VoteCheckService {
    constructor() {
        this.client = null;
        this.checkedVotes = new Map(); // Store userId -> lastChecked timestamp
        this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
        this.voteCheckTimer = null;
        this.cooldownCleanupTimer = null; // periodic DB cleanup
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

        // Periodic cleanup of expired cooldowns and old vote events (every hour)
        if (this.cooldownCleanupTimer) {
            clearInterval(this.cooldownCleanupTimer);
        }
        this.cooldownCleanupTimer = setInterval(async () => {
            try {
                const deletedCooldowns = await databaseService.cleanupExpiredVoteCooldowns(12);
                if (deletedCooldowns > 0) {
                    console.log(`🧹 Cleaned ${deletedCooldowns} expired vote cooldowns`);
                }
                
                // Backup cleanup for vote events (TTL index should handle this, but manual cleanup as backup)
                const deletedEvents = await databaseService.cleanupOldVoteEvents(24);
                if (deletedEvents > 0) {
                    console.log(`🧹 Cleaned ${deletedEvents} old vote events (24h+)`);
                }
            } catch (e) {
                console.error('Error during cleanup:', e.message);
            }
        }, 60 * 60 * 1000);
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
        if (this.cooldownCleanupTimer) {
            clearInterval(this.cooldownCleanupTimer);
            this.cooldownCleanupTimer = null;
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
            const twelveHoursMs = 12 * 60 * 60 * 1000;
            const ONE_MINUTE_MS = 60 * 1000;

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
                    
                    // Enforce 12-hour per-user-per-server cooldown (persisted in DB)
                    let lastRewarded = 0;
                    try {
                        const cooldown = await databaseService.getUserVoteCooldown(userId, targetServerId, 'topgg');
                        lastRewarded = cooldown?.lastRewardedAt ? new Date(cooldown.lastRewardedAt).getTime() : 0;
                    } catch (_) { /* ignore lookup errors */ }
                    const canReward = now - lastRewarded >= twelveHoursMs;

                    if (targetServerId && canReward) {
                        console.log(`⏳ Scheduling 25 free translations for user ${userId} in server ${targetServerId} after 1 minute`);

                        // Persist cooldown immediately to avoid duplicate scheduling
                        try {
                            // Upsert new cooldown timestamp for this user+server combination
                            await databaseService.upsertUserVoteCooldown(userId, targetServerId, new Date(now), 'topgg');
                        } catch (err) {
                            console.error('Failed to upsert cooldown before scheduling:', err.message);
                        }

                        setTimeout(async () => {
                            try {
                                const result = await monetizationService.handleVoteReward(userId, targetServerId, 25, null, 'topgg');
                                if (result && result.success) {
                                    console.log(`✅ Vote reward (25 translations) granted to server ${targetServerId} by user ${userId}`);
                                    await this.sendVoteConfirmation(userId, targetServerId, 25);
                                    // Refresh cooldown to actual grant time for this server
                                    try { await databaseService.upsertUserVoteCooldown(userId, targetServerId, new Date(), 'topgg'); } catch (_) {}
                                } else {
                                    console.log(`⚠️ Failed to grant vote reward for user ${userId}: ${result.error || 'unknown error'}`);
                                    // Roll back cooldown to allow retry next cycle for this server
                                    try { await databaseService.deleteUserVoteCooldown(userId, targetServerId, 'topgg'); } catch (_) {}
                                }
                            } catch (err) {
                                console.error('Error during delayed vote reward:', err);
                                try { await databaseService.deleteUserVoteCooldown(userId, targetServerId, 'topgg'); } catch (_) {}
                            }
                        }, ONE_MINUTE_MS);

                        newVotesProcessed++;
                        this.checkedVotes.set(userId, voteTimestamp);
                    } else {
                        if (!targetServerId) {
                            console.log(`⚠️ No server found for user ${userId}, skipping vote reward`);
                        } else {
                            const remaining = twelveHoursMs - (now - lastRewarded);
                            const hrs = Math.max(0, Math.floor(remaining / (60 * 60 * 1000)));
                            const mins = Math.max(0, Math.ceil((remaining % (60 * 60 * 1000)) / (60 * 1000)));
                            console.log(`⛔ User ${userId} already received free translations within 12 hours. Try again in ~${hrs}h ${mins}m`);
                        }
                        // Mark as checked to avoid reprocessing this same vote
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
    async sendVoteConfirmation(userId, serverId, amount = 20) {
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
                .setTitle('🎉 Free Credits Added!')
                .setDescription(`**${user.username}** voted for this server!\n\n**${amount} free translations** have been added to this server. Thank you for supporting AirTranslator!`)
                .setColor('#00ff88')
                .setFooter({
                    text: 'AirTranslator • Vote rewards',
                    iconURL: this.client.user.displayAvatarURL()
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
