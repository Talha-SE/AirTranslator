const databaseService = require('../../services/databaseService');

function parsePostData(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    const data = {};
                    for (const [key, value] of params) {
                        data[key] = value;
                    }
                    resolve(data);
                } else {
                    resolve({ body });
                }
            } catch {
                resolve({ body });
            }
        });
    });
}

function buildFeedbackStats(entries = []) {
    const stats = {
        totalResponses: entries.length,
        freeUsers: 0,
        paidUsers: 0,
        trialUsers: 0,
        recommendYes: 0,
        dashboardLoveIt: 0
    };

    entries.forEach((entry) => {
        const answers = entry?.answers || {};
        if (answers.planType === 'free') stats.freeUsers += 1;
        if (answers.planType === 'paid') stats.paidUsers += 1;
        if (answers.planType === 'trial') stats.trialUsers += 1;
        if (answers.recommendScore === 'yes') stats.recommendYes += 1;
        if (answers.dashboardExperience === 'love_it') stats.dashboardLoveIt += 1;
    });

    return stats;
}

async function getFeedbackData(req, res) {
    try {
        const [settings, feedbackEntries] = await Promise.all([
            databaseService.getFeedbackSettings(),
            databaseService.getRecentFeedback(300)
        ]);

        const stats = buildFeedbackStats(feedbackEntries);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            settings,
            stats,
            feedbackEntries
        }));
    } catch (error) {
        console.error('Error loading feedback data:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

async function updateFeedbackSettings(req, res) {
    try {
        const postData = await parsePostData(req);
        const payload = typeof postData === 'string' ? JSON.parse(postData) : postData;
        const enabled = payload?.feedbackCollectionEnabled === true || payload?.feedbackCollectionEnabled === 'true';

        const settings = await databaseService.setFeedbackCollectionEnabled(enabled);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            settings
        }));
    } catch (error) {
        console.error('Error updating feedback settings:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

async function deleteSelectedFeedback(req, res) {
    try {
        const postData = await parsePostData(req);
        const payload = typeof postData === 'string' ? JSON.parse(postData) : postData;
        const feedbackIds = Array.isArray(payload?.feedbackIds) ? payload.feedbackIds : [];

        if (feedbackIds.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'No feedback IDs provided' }));
            return;
        }

        const deletedCount = await databaseService.deleteFeedbackByIds(feedbackIds);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deletedCount }));
    } catch (error) {
        console.error('Error deleting selected feedback:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

async function deleteAllFeedback(req, res) {
    try {
        const deletedCount = await databaseService.deleteAllFeedback();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deletedCount }));
    } catch (error) {
        console.error('Error deleting all feedback:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

module.exports = {
    getFeedbackData,
    updateFeedbackSettings,
    deleteSelectedFeedback,
    deleteAllFeedback
};
