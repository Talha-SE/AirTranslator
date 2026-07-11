const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const VoiceCallTranslation = require('../models/VoiceCallTranslation');
const voiceCallTranslationService = require('../services/voiceCallTranslationService');
const Server = require('../models/Server');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('call')
        .setDescription('Start voice call translation in the configured voice channel')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Start or stop translation')
                .addChoices(
                    { name: '▶️ Start', value: 'start' },
                    { name: '⏹️ Stop', value: 'stop' }
                )
                .setRequired(false)),

    async execute(interaction) {
        const { guild, member } = interaction;

        if (!guild) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Check if user has Manage Guild permission
        if (!member.permissions.has('ManageGuild')) {
            await interaction.reply({
                content: '❌ You need the **Manage Server** permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const action = interaction.options.getString('action') || 'start';

        // If stop action
        if (action === 'stop') {
            if (!voiceCallTranslationService.isTranslationActive(guild.id)) {
                await interaction.reply({
                    content: 'ℹ️ No active voice translation to stop.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.deferReply();

            const result = await voiceCallTranslationService.stopTranslation(guild.id, interaction.client);

            if (result.success) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle('⏹️ Voice Translation Stopped')
                    .setDescription('The bot has left the voice channel.')
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply({
                    content: `❌ Failed to stop: ${result.error}`
                });
            }
            return;
        }

        // Start action — check if already active
        if (voiceCallTranslationService.isTranslationActive(guild.id)) {
            // Check if the connection is actually healthy, or just stale
            const isHealthy = voiceCallTranslationService.isConnectionHealthy(guild.id);
            if (isHealthy === false) {
                // Stale connection — auto-cleanup and proceed
                await voiceCallTranslationService.stopTranslation(guild.id, interaction.client);
                // Continue to start flow below
            } else {
                const status = voiceCallTranslationService.getTranslationStatus(guild.id);
                const channel = guild.channels.cache.get(status.voiceChannelId);
                await interaction.reply({
                    content: `ℹ️ Voice translation is already active in ${channel ? `<#${channel.id}>` : 'a voice channel'}. Use \`/call action:stop\` to stop it first.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
        }

        // Premium gate — VCT requires premium (isExempt)
        const serverDoc = await Server.findOne({ serverId: guild.id });
        if (!serverDoc?.monetization?.isExempt) {
            const premiumEmbed = new EmbedBuilder()
                .setColor(0xFFAA00)
                .setTitle('🔒 Premium Feature')
                .setDescription(
                    'Voice Call Translation is a **premium-only** feature.\n\n' +
                    '**To unlock:**\n' +
                    '1. Visit [Patreon](https://www.patreon.com/c/tsio/membership)\n' +
                    '2. Subscribe to a premium plan\n' +
                    '3. Your server will be activated automatically\n\n' +
                    '✨ *Premium also unlocks unlimited translations and priority support!*'
                )
                .setTimestamp();

            await interaction.reply({ embeds: [premiumEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // Load saved settings
        const settings = await VoiceCallTranslation.findOne({ guildId: guild.id });

        if (!settings || !settings.enabled) {
            const embed = new EmbedBuilder()
                .setColor(0xFFAA00)
                .setTitle('⚠️ No Voice Translation Setup Found')
                .setDescription(
                    'You need to configure voice call translation first from the dashboard.\n\n' +
                    '**Steps:**\n' +
                    '1. Open the [Dashboard](https://airtranslator.brevios.com/dashboard)\n' +
                    '2. Select your server\n' +
                    '3. Go to **Voice Call Translation** tab\n' +
                    '4. Enable it, pick a voice channel & languages\n' +
                    '5. Save configuration\n\n' +
                    'Then come back and use `/call` to start!'
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            return;
        }

        if (!settings.voiceChannelId) {
            await interaction.reply({
                content: '❌ No voice channel configured. Please set one from the dashboard first.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (!settings.targetLanguage) {
            await interaction.reply({
                content: '❌ No target language configured. Please set one from the dashboard first.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Check bot permissions in the voice channel
        const voiceChannel = guild.channels.cache.get(settings.voiceChannelId);
        if (!voiceChannel) {
            await interaction.reply({
                content: '❌ The configured voice channel no longer exists. Please reconfigure from the dashboard.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const botMember = guild.members.me;
        const botPerms = voiceChannel.permissionsFor(botMember);

        const missingPerms = [];
        if (!botPerms?.has('Connect')) missingPerms.push('Connect');
        if (!botPerms?.has('Speak')) missingPerms.push('Speak');
        if (!botPerms?.has('ViewChannel')) missingPerms.push('View Channel');

        if (missingPerms.length > 0) {
            await interaction.reply({
                content: `❌ I'm missing permissions in ${voiceChannel}: **${missingPerms.join('**, **')}**\nPlease grant these permissions and try again.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Check if there are users in the channel (optional — warn but proceed)
        const humanMembers = voiceChannel.members.filter(m => !m.user.bot).size;

        // Defer reply — joining may take a moment
        await interaction.deferReply();

        const sourceLang = settings.sourceLanguage === 'auto' ? 'Auto-Detect' : settings.sourceLanguage;
        const targetLang = settings.targetLanguage;

        const embed = new EmbedBuilder()
            .setColor(0x7C3AED)
            .setTitle('🎤 Joining Voice Channel...')
            .setDescription(
                `Connecting to **${voiceChannel.name}**...\n\n` +
                `🌐 **${sourceLang}** → **${targetLang}**\n` +
                    `🤖 Model: \`${settings.model || 'gemini-3.5-live-translate-preview'}\`\n` +
                `🔊 Voice: \`${settings.voice || 'Aoede'}\``
            )
            .setFooter({ text: 'The bot will start translating once connected.' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Start the translation
        const result = await voiceCallTranslationService.startTranslation(
            guild.id,
            settings.voiceChannelId,
            settings.sourceLanguage || 'auto',
            settings.targetLanguage,
            settings.model || 'gemini-3.5-live-translate-preview',
            interaction.client,
            settings.voice || 'Aoede'
        );

        if (result.success) {
            const successEmbed = new EmbedBuilder()
                .setColor(0x22C55E)
                .setTitle('✅ Voice Translation Active!')
                .setDescription(
                    `The bot is now live in **${voiceChannel.name}** and translating audio.\n\n` +
                    `🌐 **${sourceLang}** → **${targetLang}**\n` +
                    `🎤 Use \`/call action:stop\` to disconnect.`
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });
        } else {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Failed to Join')
                .setDescription(
                    `Could not connect to **${voiceChannel.name}**.\n\n` +
                    `**Reason:** ${result.error || 'Unknown error'}\n\n` +
                    `Make sure the bot has the required permissions and the channel exists.`
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
