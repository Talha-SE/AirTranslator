const { Client, GatewayIntentBits, Collection, EmbedBuilder, Events, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, Partials } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const TTSSettings = require('./models/TTSSettings');
const databaseService = require('./services/databaseService');
const analyticsService = require('./services/analyticsService');
const translationQueueService = require('./services/translationQueueService');
const voteCheckService = require('./services/voteCheckService');
const { translateTextToMultipleLanguages } = require('./services/mistralService');
const { AutoPoster } = require('topgg-autoposter');
require('dotenv').config();

// Lightweight structured logger with levels, timestamps, and ANSI colors
const LOGGER_LEVELS = ['debug', 'info', 'success', 'warn', 'error'];
const COLORS = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  gray: '\x1b[90m', blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const ICONS = { debug: '🐛', info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
const LEVEL_COLOR = { debug: COLORS.gray, info: COLORS.blue, success: COLORS.green, warn: COLORS.yellow, error: COLORS.red };
const ACTIVE_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

function timeStamp() {
  const now = new Date();
  return now.toISOString();
}

function asPlainObject(errOrObj) {
  if (!errOrObj) return undefined;
  if (errOrObj instanceof Error) {
    return { name: errOrObj.name, message: errOrObj.message, stack: errOrObj.stack };
  }
  // Avoid circular JSON; shallow copy primitives
  try { return JSON.parse(JSON.stringify(errOrObj)); } catch { return { note: 'unserializable_meta' }; }
}

function createLogger(scope) {
  const minIndex = LOGGER_LEVELS.indexOf(ACTIVE_LEVEL) === -1 ? 1 : LOGGER_LEVELS.indexOf(ACTIVE_LEVEL);
  const base = (level, message, meta) => {
    const idx = LOGGER_LEVELS.indexOf(level);
    if (idx < minIndex) return;
    const color = LEVEL_COLOR[level] || COLORS.blue;
    const icon = ICONS[level] || ICONS.info;
    const ts = timeStamp();
    const scopePart = scope ? ` ${COLORS.dim}[${scope}]${COLORS.reset}` : '';
    const metaObj = asPlainObject(meta);
    const metaPart = metaObj ? ` ${COLORS.dim}${JSON.stringify(metaObj)}${COLORS.reset}` : '';
    // eslint-disable-next-line no-console
    console.log(`${COLORS.dim}${ts}${COLORS.reset} ${color}${icon} ${level.toUpperCase()}${COLORS.reset}${scopePart} ${message}${metaPart}`);
  };
  return {
    debug: (m, meta) => base('debug', m, meta),
    info: (m, meta) => base('info', m, meta),
    success: (m, meta) => base('success', m, meta),
    warn: (m, meta) => base('warn', m, meta),
    error: (m, meta) => base('error', m, meta),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

const logger = createLogger('bot');

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
                logger.info('[VoicePresence] Joined configured TTS channel due to user presence', {
                    guildId: guild.id,
                    channelId: voiceChannel.id,
                    nonBotCount,
                });
            }
        } else {
            // Leave if empty
            if (connection) {
                try { connection.destroy(); } catch {}
                logger.info('[VoicePresence] Left configured TTS channel because it is empty', {
                    guildId: guild.id,
                    channelId: voiceChannel.id,
                });
            }
        }
    } catch (err) {
        logger.error('[VoicePresence] voiceStateUpdate error', err);
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
                logger.info('[PeriodicCheck] Left voice channel - no TTS setup found', { guildId: guild.id });
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
                logger.info('[PeriodicCheck] Rejoined voice channel', { guildId: guild.id, channelId: voiceChannel.id });
            } else if (nonBotCount === 0 && connection) {
                connection.destroy();
                logger.info('[PeriodicCheck] Left empty voice channel', { guildId: guild.id, channelId: voiceChannel.id });
            }
        }
    } catch (error) {
        logger.error('[PeriodicCheck] Error', error);
    }
}, 120000); // Check every 2 minutes

client.on('guildCreate', async (guild) => {
    logger.success(`Joined new server: ${guild.name}`);
    
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
        logger.warn('Failed to send welcome message', error);
    }
    
    analyticsService.updateServerList(client);
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            logger.warn(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            // Execute command directly without deferring
            await command.execute(interaction);
        } catch (error) {
            logger.error(`Error executing ${interaction.commandName}`, error);

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
                logger.error('Error handling command error', err);
            }
        }
    } else if (interaction.isButton()) {
        try {
            const customId = interaction.customId || '';
            // Debug log to trace unknown button issues
            logger.debug('[Button] Received button interaction', { customId, inGuild: interaction.inGuild(), userId: interaction.user?.id });

            if (customId.startsWith('premium_plans')) {
                // User explicitly clicked Premium Plans; DM them the review card with the "I Paid" button
                try {
                    const serverId = customId.includes(':') ? customId.split(':')[1] : (interaction.guildId || null);
                    const serverName = interaction.guild?.name || 'Unknown Server';
                    const embed = {
                        color: 0x5865F2,
                        title: '💎 Premium Payment Review',
                        description: 'If you have completed the premium payment, press the button below to request approval. Our team will review and exempt your server shortly.',
                        fields: [
                            { name: 'Server', value: serverName, inline: true },
                            { name: 'Server ID', value: serverId || 'N/A', inline: true }
                        ],
                        timestamp: new Date().toISOString()
                    };
                    const row = {
                        type: 1,
                        components: [
                            {
                                type: 2,
                                custom_id: `premium_request:${serverId || ''}`,
                                label: '✅ I Paid - Request Approval',
                                style: 1
                            }
                        ]
                    };

                    await interaction.user.send({ embeds: [embed], components: [row] });
                    // Acknowledge in channel ephemerally
                    if (interaction.inGuild()) {
                        await interaction.reply({ content: '📩 I sent you a DM with the premium approval button.', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: '📩 Check this DM for the premium approval button.' });
                    }
                } catch (dmErr) {
                    if (interaction.inGuild()) {
                        await interaction.reply({ content: '⚠️ I could not DM you. Please enable DMs from server members and try again.', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: '⚠️ I could not send the DM. Please try again later.' });
                    }
                }
                return;
            }

            if (customId.startsWith('premium_request')) {
                // Extract serverId if provided after ':' else fallback to recent mapping
                let serverId = customId.includes(':') ? customId.split(':')[1] : null;
                if (!serverId) {
                    // Fallback: try to use last known server the user interacted in
                    if (global.userServerTracking && interaction.user) {
                        serverId = global.userServerTracking.get(interaction.user.id) || null;
                    }
                }
                // As a last resort, use current guild if available
                if (!serverId) serverId = interaction.guildId || null;
                const serverName = interaction.guild?.name || 'Unknown Server';
                const requester = {
                    id: interaction.user.id,
                    username: interaction.user.username,
                    displayName: interaction.user.displayName || interaction.user.username
                };

                const created = await databaseService.createPremiumRequest(serverId, serverName, requester);

                const msg = `✅ Your premium payment review request has been recorded for server "${serverName}".\nRequest ID: ${created?._id || 'N/A'}\nOur team will review and approve it shortly.`;
                const embed = {
                    color: 0x6C8BFF,
                    title: '💎 Premium Request Recorded',
                    description: msg,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Air Translator • Confirmation' }
                };
                if (interaction.inGuild()) {
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ embeds: [embed] });
                }
                return;
            }

            // Default handler for unknown buttons
            await interaction.reply({
                content: 'This button interaction is not recognized.',
                flags: MessageFlags.Ephemeral
            });
        } catch (e) {
            try {
                await interaction.reply({
                    content: '❌ Failed to process your request. Please try again later.',
                    flags: MessageFlags.Ephemeral
                });
            } catch {}
        }
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
        await databaseService.connectDB();
        await client.login(process.env.DISCORD_TOKEN);
        
        // Start vote checking service
        voteCheckService.setClient(client);
        voteCheckService.start();
        logger.info('Vote checking service started');
        
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
                    logger.success(`Top.gg Rank Booster Active | Showing ${
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
                    logger.warn('Top.gg API Error', error);
                });
            } catch (error) {
                logger.warn('Top.gg Integration Failed', error);
            }
        }
        
        // Start admin server
        require('./services/adminServer');
        
        logger.success('Bot started successfully!');
        logger.info('Admin panel will be available once the server starts');
        
        // Start processing queued translations
        translationQueueService.startQueueProcessor((content, targetLanguage) => {
            // Determine which API to use based on targetLanguage
            const apiIndex = targetLanguage.charCodeAt(0) % 2; // Simple hash to distribute
            logger.debug(`Using API ${apiIndex + 1} for ${targetLanguage}`);
            return translateTextToMultipleLanguages(
                content, 
                [targetLanguage],
                null, // auto-detect
                null, // tone settings
                translationQueueService.apiKeys[apiIndex]
            );
        });
    } catch (error) {
        logger.error('Failed to start bot', error);
        process.exit(1);
    }
}

startBot();