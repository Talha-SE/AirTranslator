const analyticsService = require('../../services/analyticsService');

/**
 * Get analytics metrics
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function getMetrics(req, res) {
    try {
        const analytics = analyticsService.getAnalytics();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            totalTranslations: analytics.totalTranslations,
            totalServers: analytics.totalServers,
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
