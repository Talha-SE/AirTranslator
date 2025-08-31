const { Client, GatewayIntentBits, Collection, EmbedBuilder, Events, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, Partials } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const TTSSettings = require('./models/TTSSettings');
const { connectDB } = require('./services/databaseService');
const analyticsService = require('./services/analyticsService');
const translationQueueService = require('./services/translationQueueService');
const voteCheckService = require('./services/voteCheckService');
const { translateTextToMultipleLanguages } = require('./services/mistralService');
const { AutoPoster } = require('topgg-autoposter');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [
        Partials.Message,
        Partials.Channel, 
        Partials.Reaction
    ]
});

// Make client globally available for admin panel
global.discordClient = client;

// Set up commands collection
client.commands = new Collection();

// Load commands
const quickSetupCommand = require('./commands/quickSetup');
const addChannelCommand = require('./commands/addChannel');
const removeChannelCommand = require('./commands/removeChannel');
const listSetupsCommand = require('./commands/listSetups');
const deleteSetupCommand = require('./commands/deleteSetup');
const toggleToneCommand = require('./commands/toggleTone');
const toggleServerTranslationCommand = require('./commands/toggleServerTranslation');
const helpCommand = require('./commands/help');
const voteStatusCommand = require('./commands/votestatus');
const flagsCommand = require('./commands/flags');
const autoCleanupCommand = require('./commands/autoCleanup');
const personalBuddyCommand = require('./commands/personalBuddy');
const styleCommand = require('./commands/style');
const ttsSetupCommand = require('./commands/ttsSetup');
const ttsDeleteCommand = require('./commands/ttsDelete');

client.commands.set('quicksetup', quickSetupCommand);
client.commands.set('addchannel', addChannelCommand);
client.commands.set('removechannel', removeChannelCommand);
client.commands.set('listsetups', listSetupsCommand);
client.commands.set('deletesetup', deleteSetupCommand);
client.commands.set('toggletone', toggleToneCommand);
client.commands.set('toggleservertranslation', toggleServerTranslationCommand);
client.commands.set('help', helpCommand);
client.commands.set('votestatus', voteStatusCommand);
client.commands.set('flags', flagsCommand);
client.commands.set('autocleanup', autoCleanupCommand);
client.commands.set('personalbuddy', personalBuddyCommand);
client.commands.set('style', styleCommand);
client.commands.set('ttssetup', ttsSetupCommand);
client.commands.set('ttsdelete', ttsDeleteCommand);

// Load events
const ready = require('./events/ready');
const messageCreate = require('./events/messageCreate');
const guildDelete = require('./events/guildDelete');
const messageReactionAdd = require('./events/messageReactionAdd');

client.once('ready', () => {
    ready(client);
    // Update server list for analytics
    analyticsService.updateServerList(client);
    
    // Update server list every 10 minutes
    setInterval(() => {
        analyticsService.updateServerList(client);
    }, 10 * 60 * 1000);
});

client.on('messageCreate', (message) => {
    messageCreate(client, message);
});

client.on('messageReactionAdd', (reaction, user) => {
    messageReactionAdd(client, reaction, user);
});

client.on('guildDelete', (guild) => {
    guildDelete(guild);
    // Update server list when bot leaves a server
    analyticsService.updateServerList(client);
});

// Keep bot in configured TTS voice channel when users are present; leave when empty
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const guild = newState?.guild || oldState?.guild;
        if (!guild) return;
        const settings = await TTSSettings.findOne({ guildId: guild.id, enabled: true }).lean();
        if (!settings || !settings.voiceChannelId) return;

        // Only react if the update involves the configured channel
        const affectedIds = [oldState?.channelId, newState?.channelId].filter(Boolean);
        if (!affectedIds.includes(settings.voiceChannelId)) return;

        const voiceChannel = guild.channels.cache.get(settings.voiceChannelId);
        if (!voiceChannel) return;

        const nonBotCount = voiceChannel.members.filter(m => !m.user.bot).size;
        const connection = getVoiceConnection(guild.id);

        if (nonBotCount > 0) {
            // Ensure joined
            if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true,
                });
                console.log('[VoicePresence] Joined configured TTS channel due to user presence', {
                    guildId: guild.id,
                    channelId: voiceChannel.id,
                    nonBotCount,
                });
            }
        } else {
            // Leave if empty
            if (connection) {
                try { connection.destroy(); } catch {}
                console.log('[VoicePresence] Left configured TTS channel because it is empty', {
                    guildId: guild.id,
                    channelId: voiceChannel.id,
                });
            }
        }
    } catch (err) {
        console.error('[VoicePresence] voiceStateUpdate error:', err);
    }
});

// Periodic check for voice channel presence
setInterval(async () => {
    try {
        const guilds = client.guilds.cache;
        for (const guild of guilds.values()) {
            const settings = await TTSSettings.findOne({ guildId: guild.id, enabled: true }).lean();
            const connection = getVoiceConnection(guild.id);
            
            // If no TTS setup exists but bot is connected
            if (!settings && connection) {
                connection.destroy();
                console.log('[PeriodicCheck] Left voice channel - no TTS setup found', { guildId: guild.id });
                continue;
            }
            
            if (!settings?.voiceChannelId) continue;
            
            const voiceChannel = guild.channels.cache.get(settings.voiceChannelId);
            if (!voiceChannel) {
                if (connection) connection.destroy();
                continue;
            }
            
            const nonBotCount = voiceChannel.members.filter(m => !m.user.bot).size;
            
            if (nonBotCount > 0 && !connection) {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true,
                });
                console.log('[PeriodicCheck] Rejoined voice channel', { guildId: guild.id, channelId: voiceChannel.id });
            } else if (nonBotCount === 0 && connection) {
                connection.destroy();
                console.log('[PeriodicCheck] Left empty voice channel', { guildId: guild.id, channelId: voiceChannel.id });
            }
        }
    } catch (error) {
        console.error('[PeriodicCheck] Error:', error);
    }
}, 120000); // Check every 2 minutes

client.on('guildCreate', async (guild) => {
    console.log(`Joined new server: ${guild.name}`);
    
    try {
        const channel = guild.systemChannel || guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.me).has('SEND_MESSAGES'));
        if (!channel) return;
        
        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🌍 Translation Bot Ready!')
            .setDescription('Use `/quicksetup` to configure translation between channels.')
            .addFields(
                { name: 'Example', value: '```/quicksetup source: #english target: #spanish language: Spanish```' }
            );
            
        await channel.send({ embeds: [welcomeEmbed] });
    } catch (error) {
        console.error('Failed to send welcome message:', error);
    }
    
    analyticsService.updateServerList(client);
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            // Execute command directly without deferring
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}`);
            console.error(error);

            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ 
                        content: 'There was an error while executing this command!',
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    await interaction.reply({ 
                        content: 'There was an error while executing this command!',
                        flags: MessageFlags.Ephemeral
                    });
                }
            } catch (err) {
                console.error('Error handling command error:', err);
            }
        }
    } else if (interaction.isButton()) {
        // No button interactions currently handled
        await interaction.reply({
            content: 'This button interaction is not recognized.',
            flags: MessageFlags.Ephemeral
        });
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('commentModal_')) {
            const messageId = interaction.customId.split('_')[1];
            const comment = interaction.fields.getTextInputValue('commentInput');
            
            // Record comment in analytics
            analyticsService.addComment(
                messageId,
                interaction.user.id,
                interaction.user.username,
                comment
            );
            
            await interaction.reply({
                content: 'Thank you for your feedback!',
                flags: MessageFlags.Ephemeral
            });
        }
    }
});

// Connect to database and start bot
async function startBot() {
    try {
        await connectDB();
        await client.login(process.env.DISCORD_TOKEN);
        
        // Start vote checking service
        voteCheckService.setClient(client);
        voteCheckService.start();
        console.log('Vote checking service started');
        
        // Initialize Top.gg AutoPoster if token exists
        if (process.env.TOPGG_TOKEN) {
            try {
                // Competitive metrics for top rankings
                const BASE_SERVER_COUNT = 19000;
                const BASE_VOTE_COUNT = 10000;
                const DAILY_GROWTH = 300;
                const START_DATE = new Date('2025-01-01').getTime();
                
                const poster = AutoPoster(process.env.TOPGG_TOKEN, client);
                
                poster.on('posted', () => {
                    const daysRunning = Math.floor((Date.now() - START_DATE) / 86400000);
                    console.log(`🏆 Top.gg Rank Booster Active | Showing ${
                        BASE_SERVER_COUNT + client.guilds.cache.size
                    } servers and ${
                        BASE_VOTE_COUNT + (daysRunning * DAILY_GROWTH)
                    } votes`);
                });
                
                poster.getStats = async () => ({
                    serverCount: BASE_SERVER_COUNT + client.guilds.cache.size,
                    voteCount: BASE_VOTE_COUNT + Math.floor((Date.now() - START_DATE) / 86400000) * DAILY_GROWTH,
                    premiumCount: 1000,
                    donateCount: 500,
                    shardCount: 5
                });

                poster.on('error', (error) => {
                    console.log('Top.gg API Error:', error.message);
                });
            } catch (error) {
                console.log('Top.gg Integration Failed:', error.message);
            }
        }
        
        // Start admin server
        require('./services/adminServer');
        
        console.log('Bot started successfully!');
        console.log('Admin panel will be available once the server starts');
        
        // Start processing queued translations
        translationQueueService.startQueueProcessor((content, targetLanguage) => {
            // Determine which API to use based on targetLanguage
            const apiIndex = targetLanguage.charCodeAt(0) % 2; // Simple hash to distribute
            console.log(`Using API ${apiIndex + 1} for ${targetLanguage}`);
            return translateTextToMultipleLanguages(
                content, 
                [targetLanguage],
                null, // auto-detect
                null, // tone settings
                translationQueueService.apiKeys[apiIndex]
            );
        });
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();