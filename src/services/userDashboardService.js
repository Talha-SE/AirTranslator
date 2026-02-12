const Server = require('../models/Server');

/**
 * Get guilds where the bot is present that the user is also in
 */
async function getUserBotGuilds(userGuilds, botClient) {
    try {
        // Get all bot guilds
        const botGuilds = Array.from(botClient.guilds.cache.values());
        
        // Filter user guilds to only show ones where the bot is present
        const commonGuilds = userGuilds.filter(userGuild => 
            botGuilds.some(botGuild => botGuild.id === userGuild.id)
        ).map(guild => {
            const botGuild = botGuilds.find(bg => bg.id === guild.id);
            return {
                id: guild.id,
                name: guild.name,
                icon: guild.icon,
                owner: guild.owner,
                permissions: guild.permissions,
                // Add additional info from bot
                memberCount: botGuild?.memberCount,
                botJoinedAt: botGuild?.joinedTimestamp
            };
        });
        
        return commonGuilds;
    } catch (error) {
        console.error('Error getting user bot guilds:', error);
        throw new Error('Failed to get user guilds');
    }
}

/**
 * Get channels for a specific guild
 */
async function getGuildChannels(guildId, botClient) {
    try {
        const guild = botClient.guilds.cache.get(guildId);
        if (!guild) {
            throw new Error('Guild not found or bot is not in this guild');
        }
        
        // Get all text channels
        const channels = Array.from(guild.channels.cache.values())
            .filter(channel => channel.type === 0) // Text channels only
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                parentId: channel.parentId,
                category: channel.parent?.name || null
            }))
            .sort((a, b) => a.position - b.position);
        
        return channels;
    } catch (error) {
        console.error('Error getting guild channels:', error);
        throw new Error('Failed to get guild channels');
    }
}

/**
 * Get server configuration for a specific guild
 */
async function getServerConfig(guildId) {
    try {
        const server = await Server.findOne({ serverId: guildId });
        if (!server) {
            return null;
        }
        
        return {
            serverId: server.serverId,
            setups: server.setups.map(setup => ({
                setupId: setup.setupId,
                name: setup.name,
                channels: setup.channels.map(ch => ({
                    channelId: ch.channelId,
                    language: ch.language
                })),
                toneEnabled: setup.toneEnabled,
                createdAt: setup.createdAt
            })),
            isPremium: server.isPremium,
            premiumTier: server.premiumTier
        };
    } catch (error) {
        console.error('Error getting server config:', error);
        throw new Error('Failed to get server configuration');
    }
}

/**
 * Update server configuration
 */
async function updateServerConfig(guildId, config) {
    try {
        let server = await Server.findOne({ serverId: guildId });
        
        if (!server) {
            server = new Server({
                serverId: guildId,
                setups: []
            });
        }
        
        // Update server configuration
        if (config.setups) {
            server.setups = config.setups;
        }
        
        await server.save();
        return server;
    } catch (error) {
        console.error('Error updating server config:', error);
        throw new Error('Failed to update server configuration');
    }
}

/**
 * Check if user has permission to manage a guild
 */
function hasGuildPermission(userGuild) {
    // Check if user has MANAGE_GUILD or ADMINISTRATOR permission
    const permissions = BigInt(userGuild.permissions);
    const MANAGE_GUILD = BigInt(0x20); // 32
    const ADMINISTRATOR = BigInt(0x8); // 8
    
    return (permissions & MANAGE_GUILD) === MANAGE_GUILD || 
           (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
           userGuild.owner === true;
}

module.exports = {
    getUserBotGuilds,
    getGuildChannels,
    getServerConfig,
    updateServerConfig,
    hasGuildPermission
};
