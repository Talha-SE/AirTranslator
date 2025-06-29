const { getServerConfig } = require('./databaseService');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

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
        this.translationIssues = {
            wrongTranslations: [],
            incorrectUsage: [],
            missingNotes: [],
            languageIssues: []
        };
        this.ISSUES_FILE = path.join(__dirname, '../data/translation_issues.json');
        this.loadExistingData();
        this.loadIssues();
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

    async loadIssues() {
        try {
            const data = await fs.readFile(this.ISSUES_FILE, 'utf8');
            Object.assign(this.translationIssues, JSON.parse(data));
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('Error loading translation issues:', err);
            }
        }
    }

    async saveIssues() {
        try {
            await fs.mkdir(path.dirname(this.ISSUES_FILE), { recursive: true });
            await fs.writeFile(this.ISSUES_FILE, JSON.stringify(this.translationIssues, null, 2));
        } catch (err) {
            console.error('Error saving translation issues:', err);
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

    recordTranslationIssue(type, originalMessage, translatedMessage, sourceLanguage, targetLanguage, channelId, userId, description) {
        const issue = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            type,
            originalMessage,
            translatedMessage,
            sourceLanguage,
            targetLanguage,
            channelId,
            userId,
            description
        };

        switch(type) {
            case 'wrong_translation':
                this.translationIssues.wrongTranslations.push(issue);
                break;
            case 'incorrect_usage':
                this.translationIssues.incorrectUsage.push(issue);
                break;
            case 'missing_note':
                this.translationIssues.missingNotes.push(issue);
                break;
            case 'language_issue':
                this.translationIssues.languageIssues.push(issue);
                break;
        }

        // Save to file in background
        this.saveIssues().catch(console.error);
    }

    getTranslationIssues() {
        return {
            wrongTranslations: [...this.translationIssues.wrongTranslations],
            incorrectUsage: [...this.translationIssues.incorrectUsage],
            missingNotes: [...this.translationIssues.missingNotes],
            languageIssues: [...this.translationIssues.languageIssues]
        };
    }
}

// Create singleton instance
const analyticsService = new AnalyticsService();

// Bind all methods to maintain 'this' context
const boundService = {};
Object.getOwnPropertyNames(AnalyticsService.prototype)
    .filter(prop => typeof analyticsService[prop] === 'function' && prop !== 'constructor')
    .forEach(method => {
        boundService[method] = analyticsService[method].bind(analyticsService);
    });

// Add any additional properties
Object.assign(boundService, {
    // Add any non-method properties here if needed
});

module.exports = boundService;
