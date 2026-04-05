const databaseService = require('./databaseService');

class MonetizationService {
    constructor() {
        this.globalSettings = {
            defaultFreeTranslationLimit: 50,
            enableGlobalRestriction: false
        };
        this.settingsLoaded = false;
        // Vote tracking will now use database instead of in-memory storage
    }

    /**
     * Normalize any date-like input to UTC date-only precision (00:00:00)
     */
    normalizeDateOnly(dateInput) {
        if (!dateInput) return null;

        const parsed = new Date(dateInput);
        if (Number.isNaN(parsed.getTime())) return null;

        return new Date(Date.UTC(
            parsed.getUTCFullYear(),
            parsed.getUTCMonth(),
            parsed.getUTCDate()
        ));
    }

    /**
     * Calculate the next monthly renewal date using the same day-of-month as premium join date.
     */
    calculateNextRenewalDate(premiumJoinedAt, fromDate = new Date()) {
        const joined = this.normalizeDateOnly(premiumJoinedAt);
        if (!joined) return null;

        const reference = this.normalizeDateOnly(fromDate) || new Date();
        const renewalDay = joined.getUTCDate();

        if (joined.getTime() > reference.getTime()) {
            return joined;
        }

        const buildUtcDate = (year, month) => {
            const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            const safeDay = Math.min(renewalDay, daysInMonth);
            return new Date(Date.UTC(year, month, safeDay));
        };

        let candidate = buildUtcDate(reference.getUTCFullYear(), reference.getUTCMonth());

        // If today is renewal day, next renewal is the following month.
        if (candidate.getTime() <= reference.getTime()) {
            let nextMonth = reference.getUTCMonth() + 1;
            let year = reference.getUTCFullYear();
            if (nextMonth > 11) {
                nextMonth = 0;
                year += 1;
            }
            candidate = buildUtcDate(year, nextMonth);
        }

        return candidate;
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
                    premiumJoinedAt: null,
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
                isRestricted: true,
                isExempt: false,
                premiumJoinedAt: null,
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

            // Check if server is exempt with optional expiry
            if (serverSettings.isExempt) {
                // If there's an expiry and it has passed, clear exemption and revert to restricted
                if (serverSettings.exemptUntil && new Date(serverSettings.exemptUntil).getTime() < Date.now()) {
                    console.log(`⏰ Exemption expired for server ${serverId}, reverting to restricted status`);
                    serverSettings.isExempt = false;
                    serverSettings.exemptUntil = null;
                    serverSettings.isRestricted = true;
                    await this.updateServerSettings(serverId, serverSettings);
                } else {
                    return true;
                }
            }

            // Get the effective limit (custom limit takes priority, otherwise use global default)
            const effectiveLimit = serverSettings.customLimit || this.globalSettings.defaultFreeTranslationLimit;

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
            const premiumJoinedAt = serverSettings.premiumJoinedAt || null;
            const nextRenewalDate = this.calculateNextRenewalDate(premiumJoinedAt);
            
            return {
                translationCount: server?.translationCount || 0,
                isRestricted: serverSettings.isRestricted || this.globalSettings.enableGlobalRestriction,
                isExempt: serverSettings.isExempt,
                exemptUntil: serverSettings.exemptUntil || null,
                premiumJoinedAt,
                nextRenewalDate,
                canTranslate: await this.canTranslate(serverId),
                freeTranslationLimit: serverSettings.customLimit || this.globalSettings.defaultFreeTranslationLimit,
                lastReset: serverSettings.lastReset
            };
        } catch (error) {
            console.error('Error getting server stats:', error);
            return {
                translationCount: 0,
                isRestricted: false,
                isExempt: false,
                premiumJoinedAt: null,
                nextRenewalDate: null,
                canTranslate: true,
                freeTranslationLimit: this.globalSettings.defaultFreeTranslationLimit,
                lastReset: new Date()
            };
        }
    }

    /**
     * Set or clear premium join date for a server.
     */
    async setPremiumJoinDate(serverId, joinDate = null) {
        const serverSettings = await this.getServerSettings(serverId);

        if (joinDate) {
            const normalizedDate = this.normalizeDateOnly(joinDate);
            if (!normalizedDate) {
                throw new Error('Invalid premium join date');
            }
            serverSettings.premiumJoinedAt = normalizedDate;
        } else {
            serverSettings.premiumJoinedAt = null;
        }

        await this.updateServerSettings(serverId, serverSettings);

        return {
            premiumJoinedAt: serverSettings.premiumJoinedAt || null,
            nextRenewalDate: this.calculateNextRenewalDate(serverSettings.premiumJoinedAt)
        };
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
    async addExemptServer(serverId, durationDays = null) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.isExempt = true;
        serverSettings.isRestricted = false;
        if (durationDays && Number.isFinite(durationDays) && durationDays > 0) {
            const ms = Math.floor(durationDays * 24 * 60 * 60 * 1000);
            serverSettings.exemptUntil = new Date(Date.now() + ms);
        } else {
            serverSettings.exemptUntil = null;
        }
        await this.updateServerSettings(serverId, serverSettings);
    }

    /**
     * Remove server from exempt list and revert to restricted status
     */
    async removeExemptServer(serverId) {
        const serverSettings = await this.getServerSettings(serverId);
        serverSettings.isExempt = false;
        serverSettings.exemptUntil = null; // Clear any expiry date
        serverSettings.isRestricted = true; // Revert to restricted status
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
                    premiumJoinedAt: null,
                    lastReset: new Date(),
                    customLimit: null
                };

                const translationCount = server.translation_count || 0;
                // Always use global default unless there's a custom limit
                const effectiveLimit = sMon.customLimit || this.globalSettings.defaultFreeTranslationLimit;
                const isRestricted = sMon.isRestricted || this.globalSettings.enableGlobalRestriction;
                const canTranslate = sMon.isExempt ? true : (isRestricted ? translationCount < effectiveLimit : true);
                const premiumJoinedAt = sMon.premiumJoinedAt || null;
                const nextRenewalDate = this.calculateNextRenewalDate(premiumJoinedAt);

                const info = {
                    id: server.server_id,
                    name: 'Unknown Server',
                    translationCount,
                    isExempt: sMon.isExempt,
                    isRestricted,
                    canTranslate,
                    freeTranslationLimit: effectiveLimit,
                    lastReset: sMon.lastReset,
                    exemptUntil: sMon.exemptUntil || null,
                    premiumJoinedAt,
                    nextRenewalDate,
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
                        const effectiveLimit = this.globalSettings.defaultFreeTranslationLimit;
                        const info = {
                            id: guild.id,
                            name: guild.name || 'Unknown Server',
                            translationCount: 0,
                            isExempt: false,
                            isRestricted: this.globalSettings.enableGlobalRestriction,
                            canTranslate: !this.globalSettings.enableGlobalRestriction || 0 < effectiveLimit,
                            freeTranslationLimit: effectiveLimit,
                            lastReset: new Date(),
                            exemptUntil: null,
                            premiumJoinedAt: null,
                            nextRenewalDate: null,
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
    async handleVoteReward(userId, serverId = null, bonusAmount = 30, userInfo = null, source = 'topgg') {
        try {
            if (!serverId) {
                console.error('handleVoteReward: serverId is required');
                return { success: false, error: 'Server ID is required' };
            }

            // Check if user can vote for this specific server (12-hour cooldown per server)
            if (!(await this.canUserVote(userId, serverId, source))) {
                const remainingTime = await this.getUserCooldownRemaining(userId, serverId, source);
                const hoursRemaining = Math.ceil(remainingTime / (60 * 60 * 1000));
                
                // Record the vote click but don't grant credits
                const infoFallback = userInfo || (userId ? { id: userId } : null);
                await this.recordVoteEvent(serverId, 0, infoFallback, source);
                
                console.log(`Vote blocked: User ${userId} is on cooldown for ${hoursRemaining} hours for source ${source}`);
                return { 
                    success: false, 
                    onCooldown: true,
                    hoursRemaining,
                    message: `You can vote again on ${source === 'topgg' ? 'Top.gg' : 'our Official Site'} in ${hoursRemaining} hours` 
                };
            }

            if (serverId) {
                // Grant bonus translations by increasing the limit
                // Get the current effective limit (custom limit or default)
                const serverSettings = await this.getServerSettings(serverId);
                const currentEffectiveLimit = serverSettings.customLimit || this.globalSettings.defaultFreeTranslationLimit;
                
                // Add bonus to the effective limit
                const newLimit = currentEffectiveLimit + bonusAmount;
                
                // Update the custom limit with the new total
                serverSettings.customLimit = newLimit;
                await this.updateServerSettings(serverId, serverSettings);
                
                // Record the successful vote event
                await this.recordVoteEvent(serverId, bonusAmount, userInfo, source);
                
                const server = await databaseService.getServer(serverId);
                const currentCount = server?.translationCount || 0;
                
                console.log(`✅ Vote reward granted: ${bonusAmount} translations added to server ${serverId} (limit: ${currentEffectiveLimit} → ${newLimit}, used: ${currentCount})`);
                
                return { 
                    success: true, 
                    bonusAmount,
                    newLimit,
                    currentCount,
                    message: `Successfully added ${bonusAmount} free translations to your server! (${currentCount}/${newLimit})` 
                };
            }
            
            return { success: false, error: 'No server ID provided' };
        } catch (error) {
            console.error('Error handling vote reward:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if user can vote for a specific server (12-hour cooldown per server) - now uses database
     */
    async canUserVote(userId, serverId, source = 'topgg') {
        if (!userId || !serverId) {
            console.warn(`⚠️ canUserVote: Missing userId or serverId - userId: ${userId}, serverId: ${serverId}`);
            return false;
        }
        
        try {
            const cooldown = await databaseService.getUserVoteCooldown(userId, serverId, source);
            
            if (!cooldown) {
                console.log(`✅ No cooldown found for user ${userId} on server ${serverId} (${source}) - can vote`);
                return true;
            }
            
            const TWELVE_HOURS = 12 * 60 * 60 * 1000;
            const now = Date.now();
            const timeSinceLastVote = now - cooldown.lastRewardedAt.getTime();
            const hoursRemaining = Math.max(0, Math.ceil((TWELVE_HOURS - timeSinceLastVote) / (60 * 60 * 1000)));
            
            const canVote = timeSinceLastVote >= TWELVE_HOURS;
            
            if (canVote) {
                console.log(`✅ Cooldown expired for user ${userId} on server ${serverId} (${source}) - can vote`);
            } else {
                console.log(`❌ Cooldown active for user ${userId} on server ${serverId} (${source}) - ${hoursRemaining}h remaining`);
            }
            
            return canVote;
        } catch (error) {
            console.error('Error checking user vote cooldown:', error);
            return true; // Allow vote on error
        }
    }

    /**
     * Get remaining cooldown time for user for a specific server - now uses database
     */
    async getUserCooldownRemaining(userId, serverId, source = 'topgg') {
        if (!userId || !serverId) {
            console.warn(`⚠️ getUserCooldownRemaining: Missing userId or serverId`);
            return 0;
        }
        
        try {
            const cooldown = await databaseService.getUserVoteCooldown(userId, serverId, source);
            
            if (!cooldown) {
                console.log(`ℹ️ No cooldown found for user ${userId} on server ${serverId} (${source}) - 0 remaining`);
                return 0;
            }
            
            const TWELVE_HOURS = 12 * 60 * 60 * 1000;
            const now = Date.now();
            const timeSinceLastVote = now - cooldown.lastRewardedAt.getTime();
            
            if (timeSinceLastVote >= TWELVE_HOURS) {
                console.log(`ℹ️ Cooldown expired for user ${userId} on server ${serverId} (${source})`);
                return 0;
            }
            
            const remaining = TWELVE_HOURS - timeSinceLastVote;
            const hoursRemaining = Math.ceil(remaining / (60 * 60 * 1000));
            console.log(`ℹ️ User ${userId} has ${hoursRemaining}h cooldown remaining on server ${serverId} (${source})`);
            
            return remaining;
        } catch (error) {
            console.error('Error getting user cooldown remaining:', error);
            return 0;
        }
    }

    /**
     * Record vote event for admin panel tracking - now uses database
     */
    async recordVoteEvent(serverId, creditsGranted, userInfo = null, source = 'topgg') {
        try {
            const now = new Date();
            
            // Update user cooldown if credits were granted (per server)
            if (creditsGranted > 0 && userInfo?.id && serverId) {
                await databaseService.upsertUserVoteCooldown(userInfo.id, serverId, now, source);
            }
            
            // Save vote event to database
            if (userInfo && userInfo.id) {
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
            console.error('❌ Error recording vote event:', error);
            console.error('Error stack:', error.stack);
        }
    }

    /**
     * Get vote statistics for admin panel - now uses database
     */
    async getVoteStats() {
        try {
            const stats = await databaseService.getVoteStats();
            // Fetch all votes from the last 24 hours (limit = 0)
            const recentVotes = await databaseService.getRecentVoteEvents(0, 24);
            
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
            console.error('❌ Error getting vote stats in monetizationService:', error);
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

    /**
     * Check all servers for expired exemptions and revert them to restricted status
     * This method should be called periodically by a cron job
     */
    async checkAndExpireExemptions() {
        try {
            const now = Date.now();
            const allServers = await databaseService.getAllServers();
            let expiredCount = 0;

            for (const server of allServers) {
                if (!server.monetization) continue;
                
                const { isExempt, exemptUntil } = server.monetization;
                
                // Check if server is exempt with an expiry date that has passed
                if (isExempt && exemptUntil && new Date(exemptUntil).getTime() < now) {
                    console.log(`⏰ Auto-expiring exemption for server ${server.server_id}, reverting to restricted`);
                    
                    // Update server to remove exemption and revert to restricted
                    server.monetization.isExempt = false;
                    server.monetization.exemptUntil = null;
                    server.monetization.isRestricted = true;
                    
                    await this.updateServerSettings(server.server_id, server.monetization);
                    expiredCount++;
                }
            }

            if (expiredCount > 0) {
                console.log(`✅ Expired ${expiredCount} server exemption(s) and reverted to restricted status`);
            }

            return expiredCount;
        } catch (error) {
            console.error('❌ Error checking and expiring exemptions:', error);
            return 0;
        }
    }
}

module.exports = new MonetizationService();
