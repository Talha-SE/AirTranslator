const { Client, GatewayIntentBits, Collection, EmbedBuilder, Events, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { connectDB } = require('./services/databaseService');
const analyticsService = require('./services/analyticsService');
const translationQueueService = require('./services/translationQueueService');
const { AutoPoster } = require('topgg-autoposter');
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
const quickSetupCommand = require('./commands/quickSetup');
const addChannelCommand = require('./commands/addChannel');
const removeChannelCommand = require('./commands/removeChannel');
const listSetupsCommand = require('./commands/listSetups');
const deleteSetupCommand = require('./commands/deleteSetup');
const toggleToneCommand = require('./commands/toggleTone');
const toggleServerTranslationCommand = require('./commands/toggleServerTranslation');
const helpCommand = require('./commands/help');

client.commands.set('quicksetup', quickSetupCommand);
client.commands.set('addchannel', addChannelCommand);
client.commands.set('removechannel', removeChannelCommand);
client.commands.set('listsetups', listSetupsCommand);
client.commands.set('deletesetup', deleteSetupCommand);
client.commands.set('toggletone', toggleToneCommand);
client.commands.set('toggleservertranslation', toggleServerTranslationCommand);
client.commands.set('help', helpCommand);

// Load events
const ready = require('./events/ready');
const messageCreate = require('./events/messageCreate');
const guildDelete = require('./events/guildDelete');

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

client.on('guildDelete', (guild) => {
    guildDelete(guild);
    // Update server list when bot leaves a server
    analyticsService.updateServerList(client);
});

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
        // Handle feedback buttons
        if (interaction.customId.startsWith('feedback_')) {
            const feedbackType = interaction.customId.split('_')[1]; // 'like', 'dislike', or 'comment'
            
            if (feedbackType === 'comment') {
                // Show comment modal
                const modal = new ModalBuilder()
                    .setCustomId(`commentModal_${interaction.message.id}`)
                    .setTitle('Provide Feedback');
                    
                const commentInput = new TextInputBuilder()
                    .setCustomId('commentInput')
                    .setLabel('Your comment')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500);
                    
                const actionRow = new ActionRowBuilder().addComponents(commentInput);
                modal.addComponents(actionRow);
                
                await interaction.showModal(modal);
                return;
            }
            
            // Handle like/dislike buttons
            const reactionType = interaction.customId.split('_')[1]; // 'like' or 'dislike'
            
            // Record feedback in analytics
            analyticsService.recordFeedback(
                interaction.message.id,
                interaction.user.id,
                reactionType
            );
            
            // Update button to show user has reacted
            const buttons = interaction.message.components[0].components.map(btn => {
                const button = new ButtonBuilder(btn.data);
                if (btn.customId === interaction.customId) {
                    return button.setDisabled(true);
                }
                return button;
            });
            
            await interaction.update({
                components: [new ActionRowBuilder().addComponents(buttons)]
            });
            
            await interaction.followUp({
                content: `Thanks for your ${reactionType} feedback!`,
                flags: MessageFlags.Ephemeral
            });
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
        await connectDB();
        await client.login(process.env.DISCORD_TOKEN);
        
        // Initialize Top.gg AutoPoster if token exists
        if (process.env.TOPGG_TOKEN) {
            const poster = AutoPoster(process.env.TOPGG_TOKEN, client);
            poster.on('posted', (stats) => {
                console.log(`Posted stats to Top.gg | ${stats.serverCount} servers`);
            });
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