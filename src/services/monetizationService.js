const databaseService = require('./databaseService');

class MonetizationService {
    constructor() {
        this.globalSettings = {
            defaultFreeTranslationLimit: 20,
            enableGlobalRestriction: false
        };
        this.settingsLoaded = false;
        // Vote tracking will now use database instead of in-memory storage
    }

    /**
     * Load global monetization settings from database (lazy loading)
     */
    async loadSettings() {
        if (this.settingsLoaded) return;
        
        try {
            const settings = await databaseService.getMonetizationSettings();
            if (settings) {
                this.globalSettings = {
                    ...this.globalSettings,
                    ...settings
                };
            }
            this.settingsLoaded = true;
        } catch (error) {
            console.error('Error getting monetization settings:', error);
            // Don't set settingsLoaded to true on error, allow retry
        }
    }

    /**
     * Ensure settings are loaded before any operation
     */
    async ensureSettingsLoaded() {
        if (!this.settingsLoaded) {
            await this.loadSettings();
        }
    }

    /**
     * Save global monetization settings to database
     */
    async saveSettings() {
        try {
            await databaseService.saveMonetizationSettings(this.globalSettings);
        } catch (error) {
            console.error('Failed to save monetization settings:', error);
        }
    }

    /**
     * Get or create server monetization settings
     */
    async getServerSettings(serverId) {
        await this.ensureSettingsLoaded();
        try {
            const server = await databaseService.getServer(serverId);
            
            // If server doesn't exist or doesn't have monetization settings, create defaults
            if (!server || !server.monetization) {
                const defaultSettings = {
                    freeTranslationLimit: this.globalSettings.defaultFreeTranslationLimit,
                    isRestricted: this.globalSettings.enableGlobalRestriction,
                    isExempt: false,
                    lastReset: new Date(),
                    customLimit: null
                };
                
                // Update server with default monetization settings
                await databaseService.updateServerMonetization(serverId, defaultSettings);
                return defaultSettings;
            }
            
            return server.monetization;
        } catch (error) {
            console.error('Error getting server settings:', error);
            // Return safe defaults
            return {
                freeTranslationLimit: this.globalSettings.defaultFreeTranslationLimit,
                isRestricted: false,
                isExempt: false,
                lastReset: new Date(),
                customLimit: null
            };
        }
    }

    /**
     * Update server monetization settings
     */
    async updateServerSettings(serverId, settings) {
        try {
            await databaseService.updateServerMonetization(serverId, settings);
        } catch (error) {
            console.error('Error updating server settings:', error);
            throw error;
        }
    }

    /**
     * Check if a server can translate messages
     */
    async canTranslate(serverId) {
        try {
            const server = await databaseService.getServer(serverId);
            if (!server) {
                // New server, allow translation
                return true;
            }

            const serverSettings = await this.getServerSettings(serverId);
            const translationCount = server.translationCount || 0;

            // Check if server is exempt
            if (serverSettings.isExempt) {
                return true;
            }

            // Get the effective limit (custom or global default)
            const effectiveLimit = serverSettings.customLimit || serverSettings.freeTranslationLimit;

            // Check if server is restricted or global restriction is enabled
            if (serverSettings.isRestricted || this.globalSettings.enableGlobalRestriction) {
                return translationCount < effectiveLimit;
            }

            return true; // No restrictions apply
        } catch (error) {
            console.error('Error checking translation permission:', error);
            return true; // Allow translation on error to prevent service disruption
        }
    }

    /**
     * Increment translation count for a server
     */
    async incrementTranslationCount(serverId) {
        try {
            await databaseService.incrementTranslationCount(serverId);
        } catch (error) {
            console.error('Error incrementing translation count:', error);
        }
    }

    /**
     * Get server translation stats
     */
    async getServerStats(serverId) {
        try {
            const server = await databaseService.getServer(serverId);
            const serverSettings = await this.getServerSettings(serverId);
            
            return {
                translationCount: server?.translationCount || 0,
                isRestricted: serverSettings.isRestricted || this.globalSettings.enableGlobalRestriction,
                isExempt: serverSettings.isExempt,
                canTranslate: await this.canTranslate(serverId),
                freeTranslationLimit: serverSettings.customLimit || serverSettings.freeTranslationLimit,
                lastReset: serverSettings.lastReset
            };
        } catch (error) {
            console.error('Error getting server stats:', error);
            return {
                translationCount: 0,
                isRestricted: false,
                isExempt: false,
                canTranslate: true,
                freeTranslationLimit: this.globalSettings.defaultFreeTranslationLimit,
                lastReset: new Date()
            };
        }
    }

    /**
     * Update global settings
     */
    async updateGlobalSettings(settings) {
        this.globalSettings = { ...this.globalSettings, ...settings };
        await this.saveSettings();
    }

    /**
     * Add server to exempt list
     */
    async addExemptServer(serverId) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.isExempt = true;
        serverSettings.isRestricted = false;
        await this.updateServerSettings(serverId, serverSettings);
    }

    /**
     * Remove server from exempt list
     */
    async removeExemptServer(serverId) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.isExempt = false;
        await this.updateServerSettings(serverId, serverSettings);
    }

    /**
     * Add server to restricted list
     */
    async addRestrictedServer(serverId) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.isRestricted = true;
        serverSettings.isExempt = false;
        await this.updateServerSettings(serverId, serverSettings);
    }

    /**
     * Remove server from restricted list
     */
    async removeRestrictedServer(serverId) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.isRestricted = false;
        await this.updateServerSettings(serverId, serverSettings);
    }

    /**
     * Set custom limit for a server
     */
    async setCustomLimit(serverId, limit) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.customLimit = limit;
        await this.updateServerSettings(serverId, serverSettings);
    }

    /**
     * Reset translation count for a server
     */
    async resetServerCount(serverId) {
        try {
            await databaseService.resetTranslationCount(serverId);
            
            // Also update lastReset timestamp
            const serverSettings = await this.getServerSettings(serverId);
            serverSettings.lastReset = new Date();
            await this.updateServerSettings(serverId, serverSettings);
        } catch (error) {
            console.error('Error resetting translation count:', error);
        }
    }

    /**
     * Get all servers with their monetization status
     */
    async getAllServersStatus(client) {
        try {
            await this.ensureSettingsLoaded();

            // 1) Load servers known in DB
            const dbServers = await databaseService.getAllServers();

            // Map for quick lookup by id
            const byId = new Map();

            const fromDb = dbServers.map((server) => {
                const sMon = server.monetization || {
                    freeTranslationLimit: this.globalSettings.defaultFreeTranslationLimit,
                    isRestricted: this.globalSettings.enableGlobalRestriction,
                    isExempt: false,
                    lastReset: new Date(),
                    customLimit: null
                };

                const translationCount = server.translation_count || 0;
                const effectiveLimit = sMon.customLimit || sMon.freeTranslationLimit;
                const isRestricted = sMon.isRestricted || this.globalSettings.enableGlobalRestriction;
                const canTranslate = sMon.isExempt ? true : (isRestricted ? translationCount < effectiveLimit : true);

                const info = {
                    id: server.server_id,
                    name: 'Unknown Server',
                    translationCount,
                    isExempt: sMon.isExempt,
                    isRestricted,
                    canTranslate,
                    freeTranslationLimit: effectiveLimit,
                    lastReset: sMon.lastReset,
                    memberCount: undefined
                };

                byId.set(info.id, info);
                return info;
            });

            // 2) Add any guilds from the client that are not in DB yet
            const merged = [...fromDb];
            if (client && client.guilds && client.guilds.cache) {
                client.guilds.cache.forEach((guild) => {
                    if (!byId.has(guild.id)) {
                        const sMonDefault = {
                            freeTranslationLimit: this.globalSettings.defaultFreeTranslationLimit,
                            isRestricted: this.globalSettings.enableGlobalRestriction,
                            isExempt: false,
                            lastReset: new Date(),
                            customLimit: null
                        };

                        const effectiveLimit = sMonDefault.customLimit || sMonDefault.freeTranslationLimit;
                        const info = {
                            id: guild.id,
                            name: guild.name || 'Unknown Server',
                            translationCount: 0,
                            isExempt: sMonDefault.isExempt,
                            isRestricted: sMonDefault.isRestricted || this.globalSettings.enableGlobalRestriction,
                            canTranslate: !sMonDefault.isRestricted || 0 < effectiveLimit,
                            freeTranslationLimit: effectiveLimit,
                            lastReset: sMonDefault.lastReset,
                            memberCount: guild.memberCount
                        };
                        merged.push(info);
                        byId.set(guild.id, info);
                    } else {
                        // Enrich existing with live guild info
                        const existing = byId.get(guild.id);
                        existing.name = guild.name || existing.name;
                        existing.memberCount = guild.memberCount;
                    }
                });
            }

            // Optional: sort by name for stable UI
            merged.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            return merged;
        } catch (error) {
            console.error('Error getting all servers status:', error);
            return [];
        }
    }

    /**
     * Get monetization settings (global defaults)
     */
    getSettings() {
        return {
            ...this.globalSettings
        };
    }

    /**
     * Handle vote reward - grant additional translations
     */
    async handleVoteReward(userId, serverId = null, bonusAmount = 30, userInfo = null) {
        try {
            // Check if user can vote (12-hour cooldown)
            if (!(await this.canUserVote(userId))) {
                const remainingTime = await this.getUserCooldownRemaining(userId);
                const hoursRemaining = Math.ceil(remainingTime / (60 * 60 * 1000));
                
                // Record the vote click but don't grant credits
                const infoFallback = userInfo || (userId ? { id: userId } : null);
                await this.recordVoteEvent(serverId, 0, infoFallback);
                
                console.log(`Vote blocked: User ${userId} is on cooldown for ${hoursRemaining} hours`);
                return { 
                    success: false, 
                    onCooldown: true,
                    hoursRemaining,
                    message: `You can vote again in ${hoursRemaining} hours` 
                };
            }

            if (serverId) {
                // Grant bonus translations to the server
                const serverSettings = await this.getServerSettings(serverId);
                const newLimit = serverSettings.freeTranslationLimit + bonusAmount;
                
                await this.updateServerSettings(serverId, {
                    ...serverSettings,
                    freeTranslationLimit: newLimit
                });
                
                // Record the vote event with credits granted
                const infoFallback = userInfo || (userId ? { id: userId } : null);
                await this.recordVoteEvent(serverId, bonusAmount, infoFallback);
                
                console.log(`Vote reward granted: ${bonusAmount} bonus translations to server ${serverId}`);
                return { success: true, newLimit, bonusAmount };
            } else {
                // Record vote without server-specific reward but still apply cooldown
                const infoFallback = userInfo || (userId ? { id: userId } : null);
                await this.recordVoteEvent(null, 0, infoFallback);
                console.log(`Vote received from user ${userId} - no specific server reward`);
                return { success: true, message: 'Vote recorded' };
            }
        } catch (error) {
            console.error('Error handling vote reward:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if user can vote (12-hour cooldown) - now uses database
     */
    async canUserVote(userId) {
        if (!userId) return false;
        
        try {
            const cooldown = await databaseService.getUserVoteCooldown(userId);
            if (!cooldown) return true;
            
            const TWELVE_HOURS = 12 * 60 * 60 * 1000;
            const now = Date.now();
            const timeSinceLastVote = now - cooldown.lastRewardedAt.getTime();
            
            return timeSinceLastVote >= TWELVE_HOURS;
        } catch (error) {
            console.error('Error checking user vote cooldown:', error);
            return true; // Allow vote on error
        }
    }

    /**
     * Get remaining cooldown time for user - now uses database
     */
    async getUserCooldownRemaining(userId) {
        if (!userId) return 0;
        
        try {
            const cooldown = await databaseService.getUserVoteCooldown(userId);
            if (!cooldown) return 0;
            
            const TWELVE_HOURS = 12 * 60 * 60 * 1000;
            const now = Date.now();
            const timeSinceLastVote = now - cooldown.lastRewardedAt.getTime();
            
            if (timeSinceLastVote >= TWELVE_HOURS) return 0;
            
            return TWELVE_HOURS - timeSinceLastVote;
        } catch (error) {
            console.error('Error getting user cooldown remaining:', error);
            return 0;
        }
    }

    /**
     * Record vote event for admin panel tracking - now uses database
     */
    async recordVoteEvent(serverId, creditsGranted, userInfo = null) {
        try {
            const now = new Date();
            
            // Update user cooldown if credits were granted
            if (creditsGranted > 0 && userInfo?.id) {
                await databaseService.upsertUserVoteCooldown(userInfo.id, now);
            }
            
            // Save vote event to database
            if (userInfo) {
                const safeUsername = userInfo.username || `user_${userInfo.id || 'unknown'}`;
                const safeDisplayName = userInfo.displayName || safeUsername;
                const avatarUrl = typeof userInfo.displayAvatarURL === 'function' ? userInfo.displayAvatarURL() : (userInfo.avatar || null);

                const voteEventData = {
                    serverId,
                    userId: userInfo.id,
                    username: safeUsername,
                    displayName: safeDisplayName,
                    avatar: avatarUrl,
                    creditsGranted,
                    timestamp: now,
                    status: creditsGranted > 0 ? 'granted' : 'blocked_cooldown'
                };
                
                await databaseService.saveVoteEvent(voteEventData);
            }
            
            // Clean up expired cooldowns periodically
            await databaseService.cleanupExpiredVoteCooldowns(12);
        } catch (error) {
            console.error('Error recording vote event:', error);
        }
    }

    /**
     * Get vote statistics for admin panel - now uses database
     */
    async getVoteStats() {
        try {
            const stats = await databaseService.getVoteStats();
            const recentVotes = await databaseService.getRecentVoteEvents(20);
            
            return {
                totalVoteClicks: stats.totalVoteClicks,
                totalCreditsGranted: stats.totalCreditsGranted,
                todayVotes: stats.todayVotes,
                recentVotes: recentVotes.map(vote => ({
                    id: vote._id,
                    serverId: vote.serverId,
                    timestamp: vote.timestamp.toISOString(),
                    creditsGranted: vote.creditsGranted,
                    user: {
                        id: vote.userId,
                        username: vote.username,
                        displayName: vote.displayName,
                        avatar: vote.avatar
                    }
                })),
                recentVotesCount: recentVotes.length
            };
        } catch (error) {
            console.error('Error getting vote stats:', error);
            return {
                totalVoteClicks: 0,
                totalCreditsGranted: 0,
                todayVotes: 0,
                recentVotes: [],
                recentVotesCount: 0
            };
        }
    }

    /**
     * Check if user has voted recently (to prevent abuse)
     */
    async checkRecentVote(userId, serverId) {
        try {
            // Implement vote tracking if needed
            // For now, allow all votes (top.gg already handles vote cooldowns)
            return false;
        } catch (error) {
            console.error('Error checking recent vote:', error);
            return false;
        }
    }
}

module.exports = new MonetizationService();
