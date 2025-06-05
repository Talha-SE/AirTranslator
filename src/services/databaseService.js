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
        await server.save();
        
        return { server, setup: newSetup };
    } catch (error) {
        throw error;
    }
};

const getServerSetups = async (serverId) => {
    const server = await Server.findOne({ serverId });
    return server;
};

const deleteServerSetup = async (serverId, setupName) => {
    const server = await Server.findOne({ serverId });
    if (!server) {
        throw new Error('SERVER_NOT_FOUND');
    }

    const setupIndex = server.setups.findIndex(setup => setup.name === setupName);
    if (setupIndex === -1) {
        throw new Error('SETUP_NOT_FOUND');
    }

    server.setups.splice(setupIndex, 1);
    await server.save();
    
    return server;
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