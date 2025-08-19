const mongoose = require('mongoose');
const Server = require('../models/Server');
const MonetizationSettings = require('../models/MonetizationSettings');
const VoteCooldown = require('../models/VoteCooldown');
const VoteEvent = require('../models/VoteEvent');
const PersonalTranslation = require('../models/PersonalTranslation');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

/**
 * Get a user's vote cooldown record
 * @param {String} userId - The Discord user ID
 * @returns {Promise<Object|null>} - The cooldown document or null
 */
const getUserVoteCooldown = async (userId) => {
    try {
        return await VoteCooldown.findOne({ userId }).lean();
    } catch (error) {
        console.error('Error getting user vote cooldown:', error);
        return null;
    }
};

/**
 * Upsert a user's vote cooldown timestamp
 * @param {String} userId - The Discord user ID
 * @param {Date} lastRewardedAt - The timestamp to set
 * @returns {Promise<Object>} - The upserted cooldown document
 */
const upsertUserVoteCooldown = async (userId, lastRewardedAt) => {
    try {
        return await VoteCooldown.findOneAndUpdate(
            { userId },
            { $set: { lastRewardedAt } },
            { new: true, upsert: true }
        );
    } catch (error) {
        console.error('Error upserting user vote cooldown:', error);
        throw error;
    }
};

/**
 * Delete a user's vote cooldown (e.g., after 12 hours or during cleanup)
 * @param {String} userId - The Discord user ID
 * @returns {Promise<void>}
 */
const deleteUserVoteCooldown = async (userId) => {
    try {
        await VoteCooldown.deleteOne({ userId });
    } catch (error) {
        console.error('Error deleting user vote cooldown:', error);
    }
};

/**
 * Cleanup expired cooldowns older than provided hours
 * @param {number} hours - Hours threshold
 * @returns {Promise<number>} - Number of deleted docs
 */
const cleanupExpiredVoteCooldowns = async (hours = 12) => {
    try {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        const res = await VoteCooldown.deleteMany({ lastRewardedAt: { $lt: cutoff } });
        return res.deletedCount || 0;
    } catch (error) {
        console.error('Error cleaning up expired vote cooldowns:', error);
        return 0;
    }
};

/**
 * Save a vote event to the database
 * @param {Object} voteData - Vote event data
 * @returns {Promise<Object>} - The saved vote event
 */
const saveVoteEvent = async (voteData) => {
    try {
        const voteEvent = new VoteEvent(voteData);
        return await voteEvent.save();
    } catch (error) {
        console.error('Error saving vote event:', error);
        throw error;
    }
};

/**
 * Get vote statistics from database
 * @returns {Promise<Object>} - Vote statistics
 */
const getVoteStats = async () => {
    try {
        const totalVoteClicks = await VoteEvent.countDocuments();
        const totalCreditsGranted = await VoteEvent.aggregate([
            { $group: { _id: null, total: { $sum: '$creditsGranted' } } }
        ]);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayVotes = await VoteEvent.countDocuments({ 
            timestamp: { $gte: today } 
        });

        return {
            totalVoteClicks,
            totalCreditsGranted: totalCreditsGranted[0]?.total || 0,
            todayVotes
        };
    } catch (error) {
        console.error('Error getting vote stats:', error);
        return {
            totalVoteClicks: 0,
            totalCreditsGranted: 0,
            todayVotes: 0
        };
    }
};

/**
 * Get recent vote events from database
 * @param {number} limit - Number of recent votes to fetch
 * @returns {Promise<Array>} - Array of recent vote events
 */
const getRecentVoteEvents = async (limit = 20) => {
    try {
        return await VoteEvent.find()
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
    } catch (error) {
        console.error('Error getting recent vote events:', error);
        return [];
    }
};

/**
 * Delete a specific vote event by its ID
 * @param {string} voteId - The MongoDB _id of the vote event
 * @returns {Promise<boolean>} - True if a document was deleted
 */
const deleteVoteEventById = async (voteId) => {
    try {
        // Fetch the event first to know which user cooldown to clear
        const event = await VoteEvent.findById(voteId).lean();
        const res = await VoteEvent.deleteOne({ _id: voteId });
        const deleted = (res?.deletedCount || 0) > 0;

        if (deleted && event && event.userId) {
            // Only clear cooldown if this event actually granted credits
            if (typeof event.creditsGranted === 'number' && event.creditsGranted > 0) {
                try {
                    await VoteCooldown.deleteOne({ userId: event.userId });
                } catch (err) {
                    console.error('Error clearing user vote cooldown during delete:', err);
                }
            }
        }

        return deleted;
    } catch (error) {
        console.error('Error deleting vote event:', error);
        return false;
    }
};

const saveServerConfig = async (serverId, config) => {
    const server = await Server.findOneAndUpdate(
        { serverId },
        {
            $set: config,
            $setOnInsert: {
                serverUniqueId: uuidv4(),
                serverName: config.serverName || 'Unknown Server',
                translationCount: 0,
                monetization: {
                    freeTranslationLimit: 20,
                    isRestricted: false,
                    isExempt: false,
                    lastReset: new Date(),
                    customLimit: null
                }
            }
        },
        { new: true, upsert: true }
    );
    return server;
};

const getServerConfig = async (serverId) => {
    const server = await Server.findOne({ serverId }).lean();
    return server;
};

const deleteServerConfig = async (serverId) => {
    await Server.deleteOne({ serverId });
};

const updateServerConfig = async (serverId, config) => {
    const server = await Server.findOneAndUpdate(
        { serverId },
        { $set: config },
        { new: true }
    );
    return server;
};

const createServerSetup = async (serverId, serverName, setupName, channels, languages) => {
    try {
        let server = await Server.findOne({ serverId });
        
        if (!server) {
            // Create new server document with unique ID
            server = new Server({
                serverId,
                serverUniqueId: uuidv4(),
                serverName,
                setups: []
            });
        } else {
            // Update server name if it has changed, ensure serverUniqueId exists
            server.serverName = serverName;
            if (!server.serverUniqueId) {
                server.serverUniqueId = uuidv4();
            }
        }

        // Check if setup with same name already exists
        const existingSetup = server.setups.find(setup => setup.name === setupName);
        if (existingSetup) {
            throw new Error('SETUP_NAME_EXISTS');
        }

        // Check if an identical setup already exists
        // A setup is considered identical ONLY if it has exactly the same channels AND languages in the SAME order
        const duplicateSetup = server.setups.find(setup => 
            JSON.stringify(setup.channels) === JSON.stringify(channels) &&
            JSON.stringify(setup.languages) === JSON.stringify(languages)
        );
        
        if (duplicateSetup) {
            throw new Error('SETUP_CONFIG_EXISTS');
        }

        // Add new setup
        const newSetup = {
            setupId: uuidv4(),
            name: setupName,
            channels,
            languages
        };

        server.setups.push(newSetup);
        
        // Save the server (this will create it if it's new)
        const savedServer = await server.save();
        
        return { server: savedServer, setup: newSetup };
    } catch (error) {
        throw error;
    }
};

const getServerSetups = async (serverId) => {
    const server = await Server.findOne({ serverId }).lean();
    return server;
};

const deleteServerSetup = async (serverId, setupName) => {
    try {
        // First, find the server document
        const server = await Server.findOne({ serverId });
        
        if (!server) {
            throw new Error('SERVER_NOT_FOUND');
        }

        // Find the setup by name
        const setupIndex = server.setups.findIndex(setup => setup.name === setupName);
        
        if (setupIndex === -1) {
            throw new Error('SETUP_NOT_FOUND');
        }

        // Store setup info for logging/response
        const deletedSetup = server.setups[setupIndex];
        
        // Remove the setup from the array using MongoDB's $pull operator
        const result = await Server.updateOne(
            { serverId },
            { $pull: { setups: { name: setupName } } }
        );
        
        // Log the result for debugging
        console.log(`MongoDB deletion result: ${JSON.stringify(result)}`);
        
        // Check if the operation was successful
        if (result.modifiedCount === 0) {
            throw new Error('DELETE_OPERATION_FAILED');
        }
        
        // Return the updated server document
        return await Server.findOne({ serverId });
    } catch (error) {
        console.error(`MongoDB deletion error for server ${serverId}, setup ${setupName}:`, error);
        throw error;
    }
};

const getSetupsByChannelId = async (serverId, channelId) => {
    const server = await Server.findOne({ serverId }).lean();
    if (!server) return [];

    // Find ALL setups that include this channel
    const matchingSetups = server.setups.filter(setup => setup.channels.includes(channelId));
    return matchingSetups;
};

// Keep the original function for backward compatibility
const getSetupByChannelId = async (serverId, channelId) => {
    const setups = await getSetupsByChannelId(serverId, channelId);
    return setups.length > 0 ? setups[0] : null;
};

/**
 * Toggle tone understanding for a specific channel
 * @param {String} serverId - The Discord server ID
 * @param {String} channelId - The channel ID to toggle tone for
 * @param {Boolean} enabled - Whether tone understanding should be enabled
 * @returns {Promise<Boolean>} - True if successful, false otherwise
 */
const toggleToneUnderstanding = async (serverId, channelId, enabled) => {
    try {
        const server = await Server.findOne({ serverId });
        
        if (!server) {
            return false;
        }
        
        // Initialize toneEnabledChannels array if it doesn't exist
        if (!server.toneEnabledChannels) {
            server.toneEnabledChannels = [];
        }
        
        // Add or remove channel from the toneEnabledChannels array
        if (enabled) {
            // Add channel if not already in the list
            if (!server.toneEnabledChannels.includes(channelId)) {
                server.toneEnabledChannels.push(channelId);
            }
        } else {
            // Remove channel if it's in the list
            server.toneEnabledChannels = server.toneEnabledChannels.filter(id => id !== channelId);
        }
        
        await server.save();
        return true;
    } catch (error) {
        console.error('Error toggling tone understanding:', error);
        return false;
    }
};

/**
 * Check if tone understanding is enabled for a channel
 * @param {String} serverId - The Discord server ID
 * @param {String} channelId - The channel ID to check
 * @returns {Promise<Boolean>} - True if tone is enabled, false otherwise
 */
const getToneSettings = async (serverId, channelId) => {
    try {
        const server = await Server.findOne({ serverId });
        
        if (!server || !server.toneEnabledChannels) {
            return false;
        }
        
        return server.toneEnabledChannels.includes(channelId);
    } catch (error) {
        console.error('Error getting tone settings:', error);
        return false;
    }
};

/**
 * Get monetization settings
 * @returns {Promise<Object>} - The monetization settings
 */
const getMonetizationSettings = async () => {
    try {
        const settings = await MonetizationSettings.findOne({ settingsId: 'global' });
        return settings;
    } catch (error) {
        console.error('Error getting monetization settings:', error);
        return null;
    }
};

/**
 * Save monetization settings
 * @param {Object} settings - The settings to save
 * @returns {Promise<Object>} - The saved settings
 */
const saveMonetizationSettings = async (settings) => {
    try {
        const savedSettings = await MonetizationSettings.findOneAndUpdate(
            { settingsId: 'global' },
            settings,
            { new: true, upsert: true }
        );
        return savedSettings;
    } catch (error) {
        console.error('Error saving monetization settings:', error);
        throw error;
    }
};

/**
 * Get server by ID
 * @param {String} serverId - The server ID
 * @returns {Promise<Object>} - The server object
 */
const getServer = async (serverId) => {
    try {
        const server = await Server.findOne({ serverId }).lean();
        return server;
    } catch (error) {
        console.error('Error getting server:', error);
        return null;
    }
};

/**
 * Increment translation count for a server
 * @param {String} serverId - The server ID
 * @returns {Promise<Object>} - The updated server
 */
const incrementTranslationCount = async (serverId) => {
    try {
        const server = await Server.findOneAndUpdate(
            { serverId },
            {
                $inc: { translationCount: 1 },
                $setOnInsert: {
                    serverUniqueId: uuidv4(),
                    serverName: 'Unknown Server',
                    monetization: {
                        freeTranslationLimit: 20,
                        isRestricted: false,
                        isExempt: false,
                        lastReset: new Date(),
                        customLimit: null
                    }
                }
            },
            { new: true, upsert: true }
        );
        return server;
    } catch (error) {
        console.error('Error incrementing translation count:', error);
        throw error;
    }
};

/**
 * Reset translation count for a server
 * @param {String} serverId - The server ID
 * @returns {Promise<Object>} - The updated server
 */
const resetTranslationCount = async (serverId) => {
    try {
        const server = await Server.findOneAndUpdate(
            { serverId },
            { $set: { translationCount: 0 } },
            { new: true }
        );
        return server;
    } catch (error) {
        console.error('Error resetting translation count:', error);
        throw error;
    }
};

/**
 * Update translation count for a server to a specific value
 * @param {String} serverId - The server ID
 * @param {Number} count - The new count value
 * @returns {Promise<Object>} - The updated server
 */
const updateServerTranslationCount = async (serverId, count) => {
    try {
        const server = await Server.findOneAndUpdate(
            { serverId },
            {
                $set: { translationCount: count },
                $setOnInsert: {
                    serverUniqueId: uuidv4(),
                    serverName: 'Unknown Server',
                    monetization: {
                        freeTranslationLimit: 20,
                        isRestricted: false,
                        isExempt: false,
                        lastReset: new Date(),
                        customLimit: null
                    }
                }
            },
            { new: true, upsert: true }
        );
        return server;
    } catch (error) {
        console.error('Error updating translation count:', error);
        throw error;
    }
};

/**
 * Get all servers
 * @returns {Promise<Array>} - Array of all servers
 */
const getAllServers = async () => {
    try {
        const servers = await Server.find({}).select('serverId serverName translationCount monetization').lean();
        return servers.map(server => ({
            server_id: server.serverId,
            server_name: server.serverName,
            translation_count: server.translationCount,
            monetization: server.monetization
        }));
    } catch (error) {
        console.error('Error getting all servers:', error);
        return [];
    }
};

/**
 * Update server monetization settings
 * @param {String} serverId - The server ID
 * @param {Object} monetizationSettings - The monetization settings to update
 * @returns {Promise<Object>} - The updated server
 */
const updateServerMonetization = async (serverId, monetizationSettings) => {
    try {
        const server = await Server.findOneAndUpdate(
            { serverId },
            {
                $set: {
                    monetization: monetizationSettings
                },
                $setOnInsert: {
                    serverUniqueId: uuidv4(),
                    serverName: 'Unknown Server',
                    translationCount: 0
                }
            },
            { new: true, upsert: true }
        );
        return server;
    } catch (error) {
        console.error('Error updating server monetization:', error);
        throw error;
    }
};

/**
 * Toggle personal translation for a user
 * @param {String} userId - The Discord user ID
 * @param {Boolean} enabled - Whether personal translation should be enabled
 * @param {Array} targetLanguages - Array of target languages
 * @returns {Promise<Boolean>} - True if successful, false otherwise
 */
const togglePersonalTranslation = async (userId, enabled, targetLanguages = []) => {
    try {
        if (enabled) {
            const personalTranslation = await PersonalTranslation.findOneAndUpdate(
                { userId },
                { 
                    enabled: true, 
                    targetLanguages,
                    lastUsed: new Date()
                },
                { upsert: true, new: true }
            );
            return !!personalTranslation;
        } else {
            const result = await PersonalTranslation.findOneAndUpdate(
                { userId },
                { enabled: false },
                { new: true }
            );
            return !!result;
        }
    } catch (error) {
        console.error('Error toggling personal translation:', error);
        return false;
    }
};

/**
 * Get personal translation settings for a user
 * @param {String} userId - The Discord user ID
 * @returns {Promise<Object|null>} - Personal translation settings or null
 */
const getPersonalTranslationSettings = async (userId) => {
    try {
        const settings = await PersonalTranslation.findOne({ userId, enabled: true }).lean();
        return settings;
    } catch (error) {
        console.error('Error getting personal translation settings:', error);
        return null;
    }
};

/**
 * Record a personal translation usage
 * @param {String} userId - The Discord user ID
 * @returns {Promise<Boolean>} - True if successful, false otherwise
 */
const recordPersonalTranslation = async (userId) => {
    try {
        const settings = await PersonalTranslation.findOne({ userId, enabled: true });
        if (settings) {
            await settings.recordTranslation();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error recording personal translation:', error);
        return false;
    }
};

/**
 * Toggle translation style (thread-based or text-based) for server or specific channel
 * @param {string} serverId - Server ID
 * @param {string} channelId - Channel ID (null for server-wide)
 * @param {boolean} isThreadBased - Whether to use thread-based translation
 * @returns {boolean} Success status
 */
const toggleTranslationStyle = async (serverId, channelId = null, isThreadBased = false) => {
    try {
        const server = await Server.findOne({ serverId });
        if (!server) {
            console.log(`Server ${serverId} not found for translation style toggle`);
            return false;
        }

        if (channelId) {
            // Channel-specific setting
            if (!server.threadStyleChannels) {
                server.threadStyleChannels = [];
            }

            if (isThreadBased) {
                // Add channel to thread style list if not already present
                if (!server.threadStyleChannels.includes(channelId)) {
                    server.threadStyleChannels.push(channelId);
                }
            } else {
                // Remove channel from thread style list
                server.threadStyleChannels = server.threadStyleChannels.filter(id => id !== channelId);
            }
        } else {
            // Server-wide setting
            server.threadStyleEnabled = isThreadBased;
        }

        await server.save();
        console.log(`Translation style updated for server ${serverId}, channel ${channelId || 'server-wide'}: ${isThreadBased ? 'thread' : 'text'}`);
        return true;
    } catch (error) {
        console.error('Error toggling translation style:', error);
        return false;
    }
};

/**
 * Check if a channel should use thread-based translation
 * @param {string} serverId - Server ID
 * @param {string} channelId - Channel ID
 * @returns {boolean} Whether to use thread-based translation
 */
const shouldUseThreadTranslation = async (serverId, channelId) => {
    try {
        const server = await Server.findOne({ serverId }).lean();
        if (!server) return false;

        // Check channel-specific setting first
        if (server.threadStyleChannels && server.threadStyleChannels.includes(channelId)) {
            return true;
        }

        // Fall back to server-wide setting
        return server.threadStyleEnabled || false;
    } catch (error) {
        console.error('Error checking thread translation setting:', error);
        return false;
    }
};

module.exports = {
    connectDB,
    saveServerConfig,
    getServerConfig,
    deleteServerConfig,
    updateServerConfig,
    createServerSetup,
    getServerSetups,
    deleteServerSetup,
    getSetupByChannelId,
    getSetupsByChannelId,
    toggleToneUnderstanding,
    getToneSettings,
    getMonetizationSettings,
    saveMonetizationSettings,
    getServer,
    incrementTranslationCount,
    resetTranslationCount,
    updateServerTranslationCount,
    updateServerMonetization,
    getAllServers,
    togglePersonalTranslation,
    getPersonalTranslationSettings,
    recordPersonalTranslation,
    toggleTranslationStyle,
    shouldUseThreadTranslation,
    getUserVoteCooldown,
    upsertUserVoteCooldown,
    deleteUserVoteCooldown,
    cleanupExpiredVoteCooldowns,
    saveVoteEvent,
    getVoteStats,
    getRecentVoteEvents,
    deleteVoteEventById
};