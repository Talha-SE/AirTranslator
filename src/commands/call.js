const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const VoiceCallTranslation = require('../models/VoiceCallTranslation');
const voiceCallTranslationService = require('../services/voiceCallTranslationService');
const Server = require('../models/Server');

const FREE_DAILY_LIMIT_MINUTES = 60;
const WARNING_MINUTES = 50;

function getTodayUTC() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function resetIfNeeded(settings) {
    const today = getTodayUTC();
    if (settings.dailyUsageDate !== today) {
        settings.dailyMinutesUsed = 0;
        settings.dailyUsageDate = today;
    }
    return settings;
}

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

        const action = interaction.options.getString('action') || 'start';

        if (action === 'stop') {
            if (!voiceCallTranslationService.isTranslationActive(guild.id)) {
                await interaction.reply({
                    content: 'ℹ️ No active voice translation to stop.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.reply({ content: '⏹️ Stopping voice translation...', flags: MessageFlags.Ephemeral });

            const result = await voiceCallTranslationService.stopTranslation(guild.id, interaction.client);

            if (result.success) {
                const elapsed = result.elapsedMinutes || 0;
                const embed = new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle('⏹️ Voice Translation Stopped')
                    .setDescription(`The bot has left the voice channel.\n\n⏱️ Session duration: **${elapsed} minute(s)**`)
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply({
                    content: `❌ Failed to stop: ${result.error}`
                });
            }
            return;
        }

        if (voiceCallTranslationService.isTranslationActive(guild.id)) {
            const isHealthy = voiceCallTranslationService.isConnectionHealthy(guild.id);
            if (isHealthy === false) {
                await voiceCallTranslationService.stopTranslation(guild.id, interaction.client);
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

        const serverDoc = await Server.findOne({ serverId: guild.id });
        const isPremium = serverDoc?.monetization?.isExempt === true;

        let settings = await VoiceCallTranslation.findOne({ guildId: guild.id });

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

        const humanMembers = voiceChannel.members.filter(m => !m.user.bot).size;

        await interaction.deferReply();

        // Daily usage check for non-premium servers
        let remainingMinutes = null;
        if (!isPremium) {
            settings = resetIfNeeded(settings);

            if (settings.dailyMinutesUsed >= FREE_DAILY_LIMIT_MINUTES) {
                const limitEmbed = new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle('⏰ Daily Free Limit Reached')
                    .setDescription(
                        `You've used all **${FREE_DAILY_LIMIT_MINUTES} free minutes** of Voice Call Translation today.\n\n` +
                        '**💡 Options:**\n' +
                        '• Come back tomorrow — your free minutes reset daily\n' +
                        '• [Go Premium](https://www.patreon.com/c/tsio/membership) for unlimited access'
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [limitEmbed] });
                await settings.save();
                return;
            }

            remainingMinutes = FREE_DAILY_LIMIT_MINUTES - settings.dailyMinutesUsed;
        }

        const sourceLang = settings.sourceLanguage === 'auto' ? 'Auto-Detect' : settings.sourceLanguage;
        const targetLang = settings.targetLanguage;

        let description =
            `Connecting to **${voiceChannel.name}**...\n\n` +
            `🌐 **${sourceLang}** → **${targetLang}**\n` +
            `🤖 Model: \`${settings.model || 'gemini-3.1-flash-live-preview'}\`\n` +
            `🔊 Voice: \`${settings.voice || 'Aoede'}\``;

        if (remainingMinutes !== null) {
            description += `\n\n⏱️ Free minutes remaining today: **${remainingMinutes} min**`;
        }

        const embed = new EmbedBuilder()
            .setColor(0x7C3AED)
            .setTitle('🎤 Joining Voice Channel...')
            .setDescription(description)
            .setFooter({ text: 'The bot will start translating once connected.' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        const result = await voiceCallTranslationService.startTranslation(
            guild.id,
            settings.voiceChannelId,
            settings.sourceLanguage || 'auto',
            settings.targetLanguage,
            settings.model || 'gemini-3.1-flash-live-preview',
            interaction.client,
            settings.voice || 'Aoede',
            remainingMinutes
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
