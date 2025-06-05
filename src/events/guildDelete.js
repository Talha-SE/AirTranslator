const { deleteServerConfig } = require('../services/databaseService');

module.exports = async (guild) => {
    try {
        await deleteServerConfig(guild.id);
        console.log(`Configuration for server ${guild.name} has been deleted.`);
    } catch (error) {
        console.error(`Failed to delete configuration for server ${guild.name}:`, error);
    }
};