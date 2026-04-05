const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const monetizationService = require('../services/monetizationService');

function toDiscordDate(dateInput, includeRelative = false) {
    if (!dateInput) return 'Not available';
    const parsed = new Date(dateInput);
    if (Number.isNaN(parsed.getTime())) return 'Not available';

    const unix = Math.floor(parsed.getTime() / 1000);
    if (includeRelative) {
        return `<t:${unix}:D> • <t:${unix}:R>`;
    }
    return `<t:${unix}:D>`;
}

function buildDashboardUrl() {
    const raw = (process.env.DASHBOARD_URL || 'https://airtranslator.brevios.com').trim();
    const base = raw.replace(/\/+$/, '');
    return base.endsWith('/dashboard') ? base : `${base}/dashboard`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('View premium status and renewal details for this server'),

    async execute(interaction) {
        try {
            if (!interaction.inGuild()) {
                await interaction.reply({
                    content: 'This command can only be used inside a server.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.deferReply();

            const serverId = interaction.guild.id;
            const stats = await monetizationService.getServerStats(serverId);

            const premiumEnabled = Boolean(stats.isExempt);
            const joinedAt = stats.premiumJoinedAt ? new Date(stats.premiumJoinedAt) : null;
            const nextRenewalDate = stats.nextRenewalDate ? new Date(stats.nextRenewalDate) : null;

            const statusLabel = premiumEnabled ? 'Enabled' : 'Disabled';
            const statusDescription = premiumEnabled
                ? 'Premium is active for this server.'
                : 'Premium is currently disabled for this server.';

            const joinedText = joinedAt
                ? toDiscordDate(joinedAt)
                : 'Not set by admin';

            const nextRenewalText = joinedAt
                ? toDiscordDate(nextRenewalDate, true)
                : 'Set the premium join date in Monetization tab first';

            const embed = new EmbedBuilder()
                .setColor(premiumEnabled ? '#10b981' : '#f59e0b')
                .setTitle('💎 Premium Membership')
                .setDescription(`${statusDescription}\n\nRenewal is calculated monthly on the same day as the premium join date.`)
                .addFields(
                    {
                        name: '🏠 Server',
                        value: `${interaction.guild.name}\nID: ${serverId}`,
                        inline: false
                    },
                    {
                        name: '📌 Status',
                        value: `**${statusLabel}**`,
                        inline: true
                    },
                    {
                        name: '📅 Premium Joined',
                        value: joinedText,
                        inline: true
                    },
                    {
                        name: '🔄 Next Renewal',
                        value: nextRenewalText,
                        inline: false
                    }
                )
                .setFooter({ text: 'Air Translator • Premium Overview' })
                .setTimestamp(new Date());

            const dashboardButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Open Dashboard')
                    .setStyle(ButtonStyle.Link)
                    .setURL(buildDashboardUrl())
            );

            await interaction.editReply({
                embeds: [embed],
                components: [dashboardButton]
            });
        } catch (error) {
            console.error('Error in /premium command:', error);

            if (interaction.deferred) {
                await interaction.editReply({
                    content: 'There was an error loading premium details. Please try again later.'
                });
            } else {
                await interaction.reply({
                    content: 'There was an error loading premium details. Please try again later.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }
};
