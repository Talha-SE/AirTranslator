const Server = require('../../models/Server');

/**
 * Parse POST data helper
 */
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

/**
 * Get list of servers
 */
async function getServers(req, res) {
    try {
        const client = global.discordClient;
        if (!client) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Bot not ready' }));
            return;
        }

        const guildSnapshots = client.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            joinedAt: guild.joinedAt ? guild.joinedAt.toISOString() : null
        }));

        const guildIds = guildSnapshots.map((guild) => guild.id);
        const serverDocs = await Server.find({ serverId: { $in: guildIds } })
            .select('serverId monetization.isExempt')
            .lean();

        const exemptMap = new Map(
            (Array.isArray(serverDocs) ? serverDocs : [])
                .map((doc) => [String(doc.serverId), doc?.monetization?.isExempt === true])
        );

        const servers = guildSnapshots.map((guild) => ({
            ...guild,
            isExempt: exemptMap.get(String(guild.id)) === true
        }));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(servers));
    } catch (error) {
        console.error('Error getting servers:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
    }
}

/**
 * Get server members
 */
async function getServerMembers(req, res, serverId) {
    try {
        if (!serverId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Server ID is required' }));
            return;
        }
        
        const client = global.discordClient;
        if (!client) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
            return;
        }
        
        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Server not found' }));
            return;
        }
        
        // Fetch all members
        await guild.members.fetch();
        
        const members = guild.members.cache.map(member => ({
            id: member.id,
            username: member.user.username,
            displayName: member.displayName,
            isBot: member.user.bot,
            joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null
        }));
        
        // Sort by display name
        members.sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, members }));
    } catch (error) {
        console.error('Error fetching server members:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Leave a server
 */
async function leaveServer(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        const { serverId } = data;
        
        if (!serverId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Server ID is required' }));
            return;
        }
        
        const client = global.discordClient;
        if (!client) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
            return;
        }
        
        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Server not found' }));
            return;
        }
        
        const serverName = guild.name;
        
        // Leave the server
        await guild.leave();
        
        console.log(`[Admin] Bot left server: ${serverName} (${serverId})`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            success: true, 
            message: `Successfully left ${serverName}`,
            serverName 
        }));
    } catch (error) {
        console.error('Error leaving server:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

module.exports = {
    getServers,
    getServerMembers,
    leaveServer
};
