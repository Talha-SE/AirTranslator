const analyticsService = require('../../services/analyticsService');

/**
 * Get analytics metrics
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function getMetrics(req, res) {
    try {
        const analytics = analyticsService.getAnalytics();
        const languagePopularity = {};
        let totalLanguageUsages = 0;

        Object.entries(analytics.languageUsage || {}).forEach(([pair, count]) => {
            const safeCount = Number(count) || 0;
            if (safeCount <= 0) return;
            const parts = pair.split('→');
            const target = (parts.length > 1 ? parts[1] : pair).toString().trim().toLowerCase();
            if (!target) return;
            languagePopularity[target] = (languagePopularity[target] || 0) + safeCount;
            totalLanguageUsages += safeCount;
        });

        const topLanguages = Object.entries(languagePopularity)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([code, count]) => ({
                code,
                count,
                percentage: totalLanguageUsages > 0 ? Number(((count / totalLanguageUsages) * 100).toFixed(1)) : 0
            }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            totalTranslations: analytics.totalTranslations,
            totalServers: analytics.totalServers,
            topLanguages,
            totalLanguageUsages,
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error('Error getting analytics metrics:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
    }
}

module.exports = {
    getMetrics
};
