const { getSetupByChannelId } = require('../services/databaseService');
const { translateMessage } = require('../services/mistralService');

module.exports = async (client, message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    try {
        // Find setup that includes this channel
        const setup = await getSetupByChannelId(message.guild.id, message.channel.id);
        if (!setup) return;

        // Get channel index and target channel
        const channelIndex = setup.channels.indexOf(message.channel.id);
        const targetChannelIndex = channelIndex === 0 ? 1 : 0;
        const targetChannelId = setup.channels[targetChannelIndex];
        const targetChannel = client.channels.cache.get(targetChannelId);

        if (!targetChannel) {
            console.error(`Target channel ${targetChannelId} not found for setup: ${setup.name}`);
            return;
        }

        // Get target language
        const targetLanguage = setup.languages[targetChannelIndex];

        // Translate the message
        const translation = await translateMessage(message.content, targetLanguage);
        
        // Send translation with setup info
        await targetChannel.send(`**${message.author.displayName}** *(${setup.name})*: ${translation}`);

    } catch (error) {
        console.error('Error in messageCreate event:', error);
    }
};