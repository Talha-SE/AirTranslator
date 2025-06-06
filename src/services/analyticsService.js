const { getServerConfig } = require('./databaseService');

class AnalyticsService {
    constructor() {
        this.analytics = {
            totalTranslations: 0,
            totalServers: 0,
            languageUsage: {},
            commandUsage: {},
            dailyStats: {},
            channelActivity: {},
            serverList: [],
            botStartTime: Date.now()
        };
        this.loadExistingData();
    }

    loadExistingData() {
        const today = new Date().toISOString().split('T')[0];
        if (!this.analytics.dailyStats[today]) {
            this.analytics.dailyStats[today] = {
                translations: 0,
                activeUsers: new Set(),
                commands: 0
            };
        }
    }
    

    recordTranslation(sourceLanguage, targetLanguage, channelId, userId) {
        this.analytics.totalTranslations++;
        
        const languagePair = `${sourceLanguage} → ${targetLanguage}`;
        this.analytics.languageUsage[languagePair] = (this.analytics.languageUsage[languagePair] || 0) + 1;
        
        this.analytics.channelActivity[channelId] = (this.analytics.channelActivity[channelId] || 0) + 1;
        
        const today = new Date().toISOString().split('T')[0];
        if (!this.analytics.dailyStats[today]) {
            this.analytics.dailyStats[today] = {
                translations: 0,
                activeUsers: new Set(),
                commands: 0
            };
        }
        this.analytics.dailyStats[today].translations++;
        this.analytics.dailyStats[today].activeUsers.add(userId);
        
        this.cleanOldData();
    }

    recordCommand(commandName, userId) {
        this.analytics.commandUsage[commandName] = (this.analytics.commandUsage[commandName] || 0) + 1;
        
        const today = new Date().toISOString().split('T')[0];
        if (!this.analytics.dailyStats[today]) {
            this.analytics.dailyStats[today] = {
                translations: 0,
                activeUsers: new Set(),
                commands: 0
            };
        }
        this.analytics.dailyStats[today].commands++;
        this.analytics.dailyStats[today].activeUsers.add(userId);
    }

    updateServerList(client) {
        this.analytics.totalServers = client.guilds.cache.size;
        this.analytics.serverList = client.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            joinedAt: guild.joinedAt.toISOString(),
            ownerId: guild.ownerId
        }));
    }

    cleanOldData() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const cutoffString = cutoffDate.toISOString().split('T')[0];
        
        Object.keys(this.analytics.dailyStats).forEach(date => {
            if (date < cutoffString) {
                delete this.analytics.dailyStats[date];
            }
        });
    }

    getAnalytics() {
        const processedDailyStats = {};
        Object.entries(this.analytics.dailyStats).forEach(([date, stats]) => {
            processedDailyStats[date] = {
                ...stats,
                activeUsers: Array.from(stats.activeUsers || [])
            };
        });

        return {
            ...this.analytics,
            dailyStats: processedDailyStats
        };
    }

    getTopLanguages(limit = 10) {
        return Object.entries(this.analytics.languageUsage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);
    }

    getTopCommands(limit = 10) {
        return Object.entries(this.analytics.commandUsage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);
    }

    getRecentActivity(days = 7) {
        const recentDates = [];
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = date.toISOString().split('T')[0];
            recentDates.push(dateString);
        }
        
        return recentDates.map(date => ({
            date,
            data: this.analytics.dailyStats[date] || { translations: 0, activeUsers: [], commands: 0 }
        }));
    }
}

// Create singleton instance
const analyticsService = new AnalyticsService();

module.exports = analyticsService;
