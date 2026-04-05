const monetizationService = require('../../services/monetizationService');
const databaseService = require('../../services/databaseService');
const { EmbedBuilder } = require('discord.js');

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
 * Update global monetization settings
 */
async function updateSettings(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        await monetizationService.updateGlobalSettings({
            defaultFreeTranslationLimit: data.defaultFreeTranslationLimit,
            enableGlobalRestriction: data.enableGlobalRestriction
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error updating monetization settings:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Add exempt server
 */
async function addExemptServer(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        await monetizationService.addExemptServer(data.serverId, data.durationDays);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error adding exempt server:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Remove exempt server
 */
async function removeExemptServer(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        await monetizationService.removeExemptServer(data.serverId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error removing exempt server:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Add restricted server
 */
async function addRestrictedServer(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        await monetizationService.addRestrictedServer(data.serverId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error adding restricted server:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Remove restricted server
 */
async function removeRestrictedServer(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        await monetizationService.removeRestrictedServer(data.serverId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error removing restricted server:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Reset server count
 */
async function resetServerCount(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        
        await monetizationService.resetServerCount(data.serverId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error resetting server count:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Set custom limit for a server
 */
async function setCustomLimit(req, res) {
    try {
        const data = await parsePostData(req);
        const { serverId, customLimit } = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (!serverId || !customLimit || customLimit < 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid server ID or limit' }));
            return;
        }
        
        await monetizationService.setCustomLimit(serverId, parseInt(customLimit));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('Error setting custom limit:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Set or clear premium join date for a server
 */
async function setPremiumJoinDate(req, res) {
    try {
        const data = await parsePostData(req);
        const payload = typeof data === 'string' ? JSON.parse(data) : data;
        const { serverId, joinDate } = payload;

        if (!serverId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Server ID is required' }));
            return;
        }

        const result = await monetizationService.setPremiumJoinDate(serverId, joinDate || null);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            premiumJoinedAt: result.premiumJoinedAt || null,
            nextRenewalDate: result.nextRenewalDate || null
        }));
    } catch (error) {
        console.error('Error setting premium join date:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Approve premium request
 */
async function approvePremiumRequest(req, res, sessionToken, getSession) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        const { requestId, durationDays } = data;
        
        if (!requestId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing requestId' }));
            return;
        }
        
        const session = getSession(sessionToken);
        const approved = await databaseService.approvePremiumRequest(
            requestId, 
            session?.username || 'admin', 
            Number(durationDays)
        );
        
        if (!approved) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Request not found' }));
            return;
        }
        
        await monetizationService.addExemptServer(approved.serverId, Number(durationDays));
        
        // Notify requester
        try {
            const client = global.discordClient;
            const days = Number(durationDays) || null;
            const expAt = approved.expiresAt ? new Date(approved.expiresAt) : null;
            const expStr = expAt ? `${expAt.toLocaleDateString()} ${expAt.toLocaleTimeString()}` : 'until further notice';
            
            if (client && approved.requesterUserId) {
                const user = await client.users.fetch(approved.requesterUserId);
                if (user) {
                    const dmEmbed = new EmbedBuilder()
                        .setColor('#6C8BFF')
                        .setTitle('💎 Premium Enabled')
                        .setDescription(
                            `✅ Your premium request for "${approved.serverName || approved.serverId}" has been approved!\n\n` +
                            (days ? `Duration: ${days} day(s). Expires: ${expStr}.\n` : `No expiry set (unlimited).\n`) +
                            `Thanks for supporting Air Translator. Enjoy unlimited translations for the approved period.`
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Air Translator • Confirmation' });
                    
                    await user.send({ embeds: [dmEmbed] }).catch(() => {});
                }
                
                const guild = await client.guilds.fetch(approved.serverId).catch(() => null);
                if (guild) {
                    let ch = guild.systemChannel || guild.channels.cache.find(c => 
                        c.type === 0 && /general|chat|announce/i.test(c.name)
                    );
                    if (!ch) {
                        ch = guild.channels.cache.find(c => 
                            c.type === 0 && 
                            c.permissionsFor(client.user)?.has(['SendMessages','EmbedLinks'])
                        );
                    }
                    if (ch && ch.permissionsFor(client.user)?.has(['SendMessages'])) {
                        const serverEmbed = new EmbedBuilder()
                            .setColor('#6C8BFF')
                            .setTitle('💎 Premium Enabled')
                            .setDescription(
                                `✅ Your premium request for "${guild.name}" has been approved!\n\n` +
                                (days ? `Duration: ${days} day(s). Expires: ${expStr}.\n` : `No expiry set (unlimited).\n`) +
                                `Thanks for supporting Air Translator!`
                            )
                            .setTimestamp()
                            .setFooter({ text: 'Air Translator • Confirmation' });
                        
                        await ch.send({ embeds: [serverEmbed] }).catch(() => {});
                    }
                }
            }
        } catch (_) { /* non-fatal */ }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            success: true, 
            serverId: approved.serverId, 
            serverName: approved.serverName,
            durationDays: Number(durationDays) || null,
            expiresAt: approved.expiresAt || null 
        }));
    } catch (error) {
        console.error('Error approving premium request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Reject premium request
 */
async function rejectPremiumRequest(req, res, sessionToken, getSession) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;
        const { requestId, reason } = data;
        
        if (!requestId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing requestId' }));
            return;
        }
        
        const session = getSession(sessionToken);
        const rejected = await databaseService.rejectPremiumRequest(
            requestId,
            session?.username || 'admin',
            reason || null
        );
        
        if (!rejected) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Request not found' }));
            return;
        }
        
        // Notify requester
        try {
            const client = global.discordClient;
            const reasonText = reason && String(reason).trim() ? String(reason).trim() : null;
            const OFFICIAL_PRICE_URL = 'https://airtranslator.brevios.com/pricing';
            const SUPPORT_SERVER_URL = 'https://discord.gg/WeynxzR9nq';
            
            if (client && rejected.requesterUserId) {
                const user = await client.users.fetch(rejected.requesterUserId);
                if (user) {
                    const dmLines = [
                        `❌ Your premium request for "${rejected.serverName || rejected.serverId}" has been rejected.`
                    ];
                    if (reasonText) {
                        dmLines.push('', `Reason: ${reasonText}`);
                    }
                    dmLines.push(
                        '',
                        `Visit [official price page](${OFFICIAL_PRICE_URL})`,
                        `Need help? Join our [support server](${SUPPORT_SERVER_URL})`,
                        '',
                        'If you believe this is a mistake, please contact support.'
                    );
                    
                    const dmEmbed = new EmbedBuilder()
                        .setColor('#ef4444')
                        .setTitle('Premium Request Rejected')
                        .setDescription(dmLines.join('\n'))
                        .setTimestamp()
                        .setFooter({ text: 'Air Translator • Notification' });
                    
                    await user.send({ embeds: [dmEmbed] }).catch(() => {});
                }
                
                const guild = await client.guilds.fetch(rejected.serverId).catch(() => null);
                if (guild) {
                    let ch = guild.systemChannel || guild.channels.cache.find(c => 
                        c.type === 0 && /general|chat|announce/i.test(c.name)
                    );
                    if (!ch) {
                        ch = guild.channels.cache.find(c => 
                            c.type === 0 && 
                            c.permissionsFor(client.user)?.has(['SendMessages','EmbedLinks'])
                        );
                    }
                    if (ch && ch.permissionsFor(client.user)?.has(['SendMessages'])) {
                        const serverLines = [
                            `❌ Your premium request for "${guild.name}" has been rejected.`
                        ];
                        if (reasonText) {
                            serverLines.push('', `Reason: ${reasonText}`);
                        }
                        serverLines.push(
                            '',
                            `Visit [official price page](${OFFICIAL_PRICE_URL})`,
                            `Need help? Join our [support server](${SUPPORT_SERVER_URL})`
                        );
                        
                        const serverEmbed = new EmbedBuilder()
                            .setColor('#ef4444')
                            .setTitle('Premium Request Rejected')
                            .setDescription(serverLines.join('\n'))
                            .setTimestamp()
                            .setFooter({ text: 'Air Translator • Notification' });
                        
                        await ch.send({ embeds: [serverEmbed] }).catch(() => {});
                    }
                }
            }
        } catch (_) { /* non-fatal */ }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            success: true, 
            serverId: rejected.serverId, 
            serverName: rejected.serverName
        }));
    } catch (error) {
        console.error('Error rejecting premium request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Delete vote record
 */
async function deleteVoteRecord(req, res) {
    try {
        const data = await parsePostData(req);
        const { voteId } = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (!voteId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'voteId required' }));
            return;
        }
        
        const deleted = await databaseService.deleteVoteEventById(voteId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: deleted }));
    } catch (error) {
        console.error('Error deleting vote record:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

/**
 * Get recent votes with filters
 */
async function getRecentVotes(req, res, reqUrl) {
    try {
        const client = global.discordClient;
        const statusFilter = (reqUrl.searchParams.get('status') || 'all').toLowerCase();
        const serverFilter = (reqUrl.searchParams.get('serverId') || '').trim();
        
        const voteStats = await monetizationService.getVoteStats();
        let recent = voteStats.recentVotes;
        
        // Enrich user data
        if (client && recent.length) {
            recent = await Promise.all(recent.map(async (vote) => {
                const uid = vote?.user?.id;
                if (!uid) return vote;
                
                const currentName = vote.user.displayName || vote.user.username || '';
                const needsEnrich = !currentName || /^\d+$/.test(currentName);
                if (!needsEnrich) return vote;
                
                try {
                    const cached = client.users.cache.get(uid);
                    if (cached) {
                        return {
                            ...vote,
                            user: {
                                ...vote.user,
                                username: cached.username || vote.user.username,
                                displayName: cached.displayName || cached.username || vote.user.displayName || vote.user.username
                            }
                        };
                    }
                    
                    const fetched = await client.users.fetch(uid);
                    return {
                        ...vote,
                        user: {
                            ...vote.user,
                            username: fetched?.username || vote.user.username,
                            displayName: fetched?.displayName || fetched?.username || vote.user.displayName || vote.user.username
                        }
                    };
                } catch (_) {
                    return vote;
                }
            }));
        }
        
        // Apply filters
        if (statusFilter === 'granted') {
            recent = recent.filter(v => Number(v.creditsGranted) > 0);
        } else if (statusFilter === 'blocked') {
            recent = recent.filter(v => !Number(v.creditsGranted) || Number(v.creditsGranted) <= 0);
        }
        
        if (serverFilter) {
            recent = recent.filter(v => (v.serverId || '').toString().includes(serverFilter));
        }
        
        const tbody = recent.map(vote => {
            const server = client ? client.guilds.cache.get(vote.serverId) : null;
            const serverName = server ? server.name : 'Unknown Server';
            const timeAgo = new Date(vote.timestamp).toLocaleString();
            const rawName = vote.user ? (vote.user.displayName || vote.user.username || '') : '';
            const isNumericOnly = /^\d+$/.test(rawName);
            const safeName = vote.user ? (
                isNumericOnly
                    ? `user_${(vote.user.id || '').toString().slice(-4)}`
                    : rawName || `user_${(vote.user.id || '').toString().slice(-4)}`
            ) : 'unknown_user';
            const isGranted = Number(vote.creditsGranted) > 0;
            const statusCell = isGranted 
                ? '<span class="badge badge-success">✅ Granted</span>' 
                : '<span class="badge badge-warning">🚫 Blocked</span>';

            const creditsBadge = isGranted 
                 ? `<span class="badge badge-success">+${vote.creditsGranted}</span>` 
                 : `<span class="badge badge-secondary">${vote.creditsGranted}</span>`;
            
            const userDisplay = vote.user ? 
                `<span class="user-mention">@${safeName}</span>
                    <br><small style="color: #6b7280;">ID: ${vote.user.id}</small>
                    <div style="margin-top: 6px;">
                        <button class="btn-xs btn-outline" onclick="copyToClipboard('${vote.user.id}')">Copy ID</button>
                        <button class="btn-xs btn-outline" onclick="window.open('https://discord.com/users/${vote.user.id}', '_blank')">Profile</button>
                    </div>` : 
                '<span style="color: #9ca3af; font-style: italic;">Unknown User</span>';
            
            return `
            <tr>
                <td><strong>${vote.serverId}</strong><br><small style="color: #6b7280;">${serverName}</small></td>
                <td>${userDisplay}</td>
                <td style="text-align: center;">${creditsBadge}</td>
                <td style="text-align: center;">${timeAgo}</td>
                <td style="text-align: center;">${statusCell}</td>
                <td style="text-align: center;">
                    <button class="btn-sm btn-danger" onclick="deleteVoteRecord('${vote.id}')">Delete</button>
                </td>
            </tr>`;
        }).join('');
        
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: true, tbody, count: voteStats.recentVotesCount }));
    } catch (error) {
        console.error('Error fetching recent votes:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
    }
}

/**
 * Bulk restrict all servers
 */
async function bulkRestrictAll(req, res) {
    try {
        const client = global.discordClient;
        if (!client) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
            return;
        }
        
        const servers = Array.from(client.guilds.cache.values());
        let affectedCount = 0;
        
        for (const guild of servers) {
            try {
                const status = await monetizationService.checkServerStatus(guild.id);
                if (!status.isExempt) {
                    await monetizationService.addRestrictedServer(guild.id);
                    affectedCount++;
                }
            } catch (err) {
                console.error(`Failed to restrict server ${guild.id}:`, err);
            }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, affectedCount }));
    } catch (error) {
        console.error('Error in bulk restrict all:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Bulk remove restrictions
 */
async function bulkRemoveRestrictions(req, res) {
    try {
        const client = global.discordClient;
        if (!client) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
            return;
        }
        
        const servers = Array.from(client.guilds.cache.values());
        let affectedCount = 0;
        
        for (const guild of servers) {
            try {
                const status = await monetizationService.checkServerStatus(guild.id);
                if (status.isRestricted && !status.isExempt) {
                    await monetizationService.removeRestrictedServer(guild.id);
                    affectedCount++;
                }
            } catch (err) {
                console.error(`Failed to remove restriction for server ${guild.id}:`, err);
            }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, affectedCount }));
    } catch (error) {
        console.error('Error in bulk remove restrictions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

/**
 * Bulk reset all counts
 */
async function bulkResetCounts(req, res) {
    try {
        const client = global.discordClient;
        if (!client) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bot not ready' }));
            return;
        }
        
        const servers = Array.from(client.guilds.cache.values());
        let affectedCount = 0;
        
        for (const guild of servers) {
            try {
                await monetizationService.resetServerCount(guild.id);
                affectedCount++;
            } catch (err) {
                console.error(`Failed to reset count for server ${guild.id}:`, err);
            }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, affectedCount }));
    } catch (error) {
        console.error('Error in bulk reset counts:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
}

module.exports = {
    updateSettings,
    addExemptServer,
    removeExemptServer,
    addRestrictedServer,
    removeRestrictedServer,
    resetServerCount,
    setCustomLimit,
    setPremiumJoinDate,
    approvePremiumRequest,
    rejectPremiumRequest,
    deleteVoteRecord,
    getRecentVotes,
    bulkRestrictAll,
    bulkRemoveRestrictions,
    bulkResetCounts
};
