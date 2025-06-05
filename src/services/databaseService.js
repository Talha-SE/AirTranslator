const mongoose = require('mongoose');
const Server = require('../models/Server');
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

        // Check if same channels and languages combination exists
        const duplicateSetup = server.setups.find(setup => 
            JSON.stringify(setup.channels.sort()) === JSON.stringify(channels.sort()) &&
            JSON.stringify(setup.languages.sort()) === JSON.stringify(languages.sort())
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

const getSetupByChannelId = async (serverId, channelId) => {
    const server = await Server.findOne({ serverId });
    if (!server) return null;

    const setup = server.setups.find(setup => setup.channels.includes(channelId));
    return setup || null;
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
    getSetupByChannelId
};