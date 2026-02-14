// Helper function to add to databaseService.js
// Add these functions to your existing databaseService.js

const Server = require('../models/Server');

/**
 * Get server settings
 */
async function getServerSettings(serverId) {
    try {
        const server = await Server.findOne({ serverId });
        return server;
    } catch (error) {
        console.error('Error getting server settings:', error);
        throw error;
    }
}

/**
 * Update server settings
 */
async function updateServerSettings(serverId, updates) {
    try {
        const server = await Server.findOneAndUpdate(
            { serverId },
            { $set: updates },
            { new: true, upsert: true }
        );
        return server;
    } catch (error) {
        console.error('Error updating server settings:', error);
        throw error;
    }
}

/**
 * Create a translation setup
 */
async function createSetup(serverId, name, channels, languages) {
    try {
        const setupId = `setup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const server = await Server.findOneAndUpdate(
            { serverId },
            {
                $push: {
                    setups: {
                        setupId,
                        name,
                        channels,
                        languages
                    }
                }
            },
            { new: true, upsert: true }
        );

        return server.setups.find(s => s.setupId === setupId);
    } catch (error) {
        console.error('Error creating setup:', error);
        throw error;
    }
}

/**
 * Delete a translation setup
 */
async function deleteSetup(serverId, setupId) {
    try {
        const server = await Server.findOneAndUpdate(
            { serverId },
            {
                $pull: {
                    setups: { setupId }
                }
            },
            { new: true }
        );

        return server;
    } catch (error) {
        console.error('Error deleting setup:', error);
        throw error;
    }
}

// Export these functions from databaseService.js
module.exports = {
    // ...existing exports,
    getServerSettings,
    updateServerSettings,
    createSetup,
    deleteSetup
};
