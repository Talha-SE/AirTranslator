const mongoose = require('mongoose');
const Server = require('../models/Server');
const { v4: uuidv4 } = require('uuid');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

const saveServerConfig = async (serverId, config) => {
    const server = await Server.findOneAndUpdate(
        { serverId },
        { $set: config },
        { new: true, upsert: true }
    );
    return server;
};

const getServerConfig = async (serverId) => {
    const server = await Server.findOne({ serverId });
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
    const server = await Server.findOne({ serverId });
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
    const server = await Server.findOne({ serverId });
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
    getToneSettings
};