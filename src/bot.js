const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { connectDB } = require('./services/databaseService');
const analyticsService = require('./services/analyticsService');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// Make client globally available for admin panel
global.discordClient = client;

// Set up commands collection
client.commands = new Collection();

// Load commands
const setupCommand = require('./commands/setup');
const quickSetupCommand = require('./commands/quickSetup');
const addChannelCommand = require('./commands/addChannel');
const removeChannelCommand = require('./commands/removeChannel');
const listSetupsCommand = require('./commands/listSetups');
const deleteSetupCommand = require('./commands/deleteSetup');
const toggleToneCommand = require('./commands/toggleTone');

client.commands.set('setup', setupCommand);
client.commands.set('quicksetup', quickSetupCommand);
client.commands.set('addchannel', addChannelCommand);
client.commands.set('removechannel', removeChannelCommand);
client.commands.set('listsetups', listSetupsCommand);
client.commands.set('deletesetup', deleteSetupCommand);
client.commands.set('toggletone', toggleToneCommand);

// Load events
const ready = require('./events/ready');
const messageCreate = require('./events/messageCreate');
const guildDelete = require('./events/guildDelete');

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Update server list in analytics
    analyticsService.updateServerList(client);
    
    // Schedule periodic updates
    setInterval(() => analyticsService.updateServerList(client), 60 * 60 * 1000); // Update every hour
});

client.on('messageCreate', (message) => {
    messageCreate(client, message);
});

client.on('guildDelete', (guild) => {
    guildDelete(guild);
    // Update server list when bot leaves a server
    analyticsService.updateServerList(client);
});

client.on('guildCreate', (guild) => {
    console.log(`Joined new server: ${guild.name} (${guild.memberCount} members)`);
    // Update server list when bot joins a server
    analyticsService.updateServerList(client);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;
 
    try {
        // Record command usage for analytics
        analyticsService.recordCommand(interaction.commandName, interaction.user.id);
        
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        const response = { 
            content: 'There was an error while executing this command!',
            flags: 64 // MessageFlags.Ephemeral
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(response);
        } else {
            await interaction.reply(response);
        }
    }
});

// Connect to database and start bot
async function startBot() {
    try {
        await connectDB();
        await client.login(process.env.DISCORD_TOKEN);
        
        // Start admin server
        require('./services/adminServer');
        
        console.log('Bot started successfully!');
        console.log('Admin panel will be available once the server starts');
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();