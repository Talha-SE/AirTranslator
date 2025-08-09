const databaseService = require('./databaseService');

class MonetizationService {
    constructor() {
        this.globalSettings = {
            defaultFreeTranslationLimit: 20,
            enableGlobalRestriction: false
        };
        this.loadSettings();
    }

    /**
     * Load global monetization settings from database
     */
    async loadSettings() {
        try {
            const settings = await databaseService.getMonetizationSettings();
            if (settings) {
                this.globalSettings = {
                    ...this.globalSettings,
                    ...settings
                };
            }
        } catch (error) {
            console.error('Failed to load monetization settings:', error);
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
            const servers = await databaseService.getAllServers();
            const serversStatus = [];

            for (const server of servers) {
                const serverSettings = await this.getServerSettings(server.server_id);
                
                let serverInfo = {
                    id: server.server_id,
                    name: 'Unknown Server',
                    translationCount: server.translation_count || 0,
                    isExempt: serverSettings.isExempt,
                    isRestricted: serverSettings.isRestricted || this.globalSettings.enableGlobalRestriction,
                    canTranslate: await this.canTranslate(server.server_id),
                    freeTranslationLimit: serverSettings.customLimit || serverSettings.freeTranslationLimit,
                    lastReset: serverSettings.lastReset
                };

                // Get server name from Discord client
                if (client) {
                    const discordServer = client.guilds.cache.get(server.server_id);
                    if (discordServer) {
                        serverInfo.name = discordServer.name;
                        serverInfo.memberCount = discordServer.memberCount;
                    }
                }

                serversStatus.push(serverInfo);
            }

            return serversStatus;
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
    async handleVoteReward(userId, serverId = null) {
        try {
            const VOTE_BONUS_TRANSLATIONS = 50;
            
            // If serverId is provided, grant translations to that specific server
            if (serverId) {
                // Get current server data
                const server = await databaseService.getServer(serverId);
                const currentCount = server?.translationCount || 0;
                
                // Subtract bonus translations (effectively granting more translations)
                const newCount = Math.max(0, currentCount - VOTE_BONUS_TRANSLATIONS);
                await databaseService.updateServerTranslationCount(serverId, newCount);
                
                console.log(`Vote reward: ${VOTE_BONUS_TRANSLATIONS} bonus translations granted to server ${serverId} by user ${userId}`);
                return { success: true, bonusTranslations: VOTE_BONUS_TRANSLATIONS, serverId };
            } else {
                // If no specific server, we could implement user-based rewards
                // For now, just log the vote
                console.log(`Vote received from user ${userId} - no specific server reward`);
                return { success: true, message: 'Vote recorded' };
            }
        } catch (error) {
            console.error('Error handling vote reward:', error);
            return { success: false, error: error.message };
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
