const { EmbedBuilder, ChannelType } = require('discord.js');
const databaseService = require('./databaseService');
const monetizationService = require('./monetizationService');
const { getUnlimitedUsageOfferTemplate } = require('./messageTemplates');

const CAMPAIGN_TRIGGER_COUNT = 5;
const pendingSends = new Set();

function canSendEmbeds(guild, channel) {
    if (!guild || !channel || channel.type !== ChannelType.GuildText) {
        return false;
    }

    const me = guild.members.me;
    if (!me) {
        return false;
    }

    const perms = channel.permissionsFor(me);
    return perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'], true) ?? false;
}

function pickDeliveryChannel(guild, preferredChannel = null) {
    if (!guild) {
        return null;
    }

    if (canSendEmbeds(guild, preferredChannel)) {
        return preferredChannel;
    }

    if (canSendEmbeds(guild, guild.systemChannel)) {
        return guild.systemChannel;
    }

    return guild.channels.cache
        .filter((ch) => ch.type === ChannelType.GuildText)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .find((ch) => canSendEmbeds(guild, ch)) || null;
}

async function markServerAsNewlyJoined(guild) {
    if (!guild?.id) {
        return null;
    }

    return databaseService.markServerAsNewlyJoined(
        guild.id,
        guild.name,
        guild.joinedAt || new Date()
    );
}

async function maybeSendUnlimitedUsageOffer({ guild, preferredChannel = null, serverSnapshot = null }) {
    if (!guild?.id) {
        return { sent: false, reason: 'missing_guild' };
    }

    const serverId = guild.id;
    if (pendingSends.has(serverId)) {
        return { sent: false, reason: 'send_in_progress' };
    }

    pendingSends.add(serverId);
    try {
        await monetizationService.ensureSettingsLoaded();
        const settings = monetizationService.getSettings();
        if (!settings.autoUnlimitedUsageCampaignEnabled) {
            return { sent: false, reason: 'campaign_disabled' };
        }

        const currentServer = serverSnapshot || await databaseService.getServer(serverId);
        const translationCount = Number(currentServer?.translationCount || 0);

        if (translationCount < CAMPAIGN_TRIGGER_COUNT) {
            return { sent: false, reason: 'below_threshold', translationCount };
        }

        const campaignState = currentServer?.campaigns?.autoUnlimitedUsage;
        if (!campaignState?.isEligible) {
            return { sent: false, reason: 'not_eligible', translationCount };
        }

        if (campaignState?.sentAt) {
            return { sent: false, reason: 'already_sent', translationCount };
        }

        const targetChannel = pickDeliveryChannel(guild, preferredChannel);
        if (!targetChannel) {
            return { sent: false, reason: 'no_channel', translationCount };
        }

        const template = getUnlimitedUsageOfferTemplate();
        const embed = new EmbedBuilder()
            .setTitle(template.title)
            .setDescription(template.content)
            .setColor(template.color)
            .setFooter({ text: 'AirTranslator Bot' })
            .setTimestamp();

        await targetChannel.send({ embeds: [embed] });
        await databaseService.markUnlimitedUsageOfferSent(serverId, translationCount);

        return {
            sent: true,
            translationCount,
            channelId: targetChannel.id,
            channelName: targetChannel.name
        };
    } catch (error) {
        return {
            sent: false,
            reason: 'send_failed',
            error: error?.message || String(error)
        };
    } finally {
        pendingSends.delete(serverId);
    }
}

module.exports = {
    CAMPAIGN_TRIGGER_COUNT,
    markServerAsNewlyJoined,
    maybeSendUnlimitedUsageOffer
};
