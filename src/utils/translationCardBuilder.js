/**
 * Translation Card Builder — Discord Components V2 Container
 *
 * Builds modern Container V2 messages for auto-translation and flag translation.
 * Uses Components V2 (flags: 32768) with type 17 (Container) + type 10 (Text Display).
 *
 * This keeps the same logical behavior as the previous EmbedBuilder approach
 * but renders as a sleek, borderless Container V2 card.
 */

const FLAGS_COMPONENTS_V2 = 32768; // 1 << 15 = IS_COMPONENTS_V2

// Component type constants (matching Discord Components V2 spec)
const TYPE_ACTION_ROW = 1;
const TYPE_BUTTON = 2;
const TYPE_TEXT_DISPLAY = 10;
const TYPE_CONTAINER = 17;

// Button style constants (matching discord.js ButtonStyle)
const BUTTON_STYLE_PRIMARY = 1;
const BUTTON_STYLE_SUCCESS = 3;
const BUTTON_STYLE_LINK = 5;

/**
 * Build a Components V2 Container for auto-translation messages.
 *
 * @param {Object}  options
 * @param {Array}   options.translations    – Array of { flag, displayLanguage, translation }
 * @param {string}  [options.authorName]    – Display name of the original message author (first chunk only)
 * @param {string}  [options.detectedLanguage] – Detected source language name
 * @param {boolean} [options.isLastChunk]   – Whether this is the last chunk (adds buttons)
 * @param {Array}   [options.buttons]       – Array of button JSON objects for the ActionRow
 * @param {boolean} [options.suppressNotifications] – Mute notifications (for thread mode)
 * @returns {Object} Raw payload with flags and components for message.send / message.reply
 */
function buildAutoTranslationContainer({
    translations,
    authorName = null,
    detectedLanguage = null,
    isLastChunk = false,
    buttons = null,
    suppressNotifications = false,
}) {
    const innerComponents = [];

    // Each translation as a Text Display component
    for (const t of translations) {
        innerComponents.push({
            type: TYPE_TEXT_DISPLAY,
            content: `${t.flag} **${t.displayLanguage}**\n${t.translation}`,
        });
    }

    // Buttons inside the container (last chunk only)
    if (isLastChunk && buttons && buttons.length > 0) {
        innerComponents.push({
            type: TYPE_ACTION_ROW,
            components: buttons,
        });
    }

    // Build the message flags (combine Components V2 + optional SuppressNotifications)
    let messageFlags = FLAGS_COMPONENTS_V2;
    if (suppressNotifications) {
        messageFlags |= 4096; // 1 << 12 = SUPPRESS_NOTIFICATIONS
    }

    return {
        flags: messageFlags,
        components: [
            {
                type: TYPE_CONTAINER,
                components: innerComponents,
            },
        ],
    };
}

/**
 * Build raw button objects for the auto-translation card.
 * Returns an array of button JSON objects suitable for an ActionRow inside a Container.
 *
 * @param {Object}  options
 * @param {string}  options.guildId          – Guild ID for custom IDs
 * @param {boolean} options.isServerExempt   – Whether the server is exempt from limits
 * @param {string}  [options.dashboardUrl]   – Dashboard URL (for exempt servers)
 * @returns {Array} Array of button JSON objects
 */
function buildAutoTranslationButtons({ guildId, isServerExempt, dashboardUrl }) {
    // Exempt servers get no buttons
    if (isServerExempt) {
        return [];
    }

    return [
        {
            type: TYPE_BUTTON,
            style: BUTTON_STYLE_SUCCESS,
            label: 'Free (Vote)',
            custom_id: `vote_on_topgg:${guildId}`,
        },
        {
            type: TYPE_BUTTON,
            style: BUTTON_STYLE_PRIMARY,
            label: 'Paid Options',
            custom_id: `see_payment_options:${guildId}`,
        },
    ];
}

/**
 * Build a Components V2 Container for flag reaction translation.
 * Shows a single translation with info link and auto-delete notice.
 *
 * @param {Object}  options
 * @param {string}  options.flag                – Flag emoji
 * @param {string}  options.displayLanguage     – Display name of the target language
 * @param {string}  options.translation         – Translated text
 * @param {string}  options.messageUrl          – URL of the original message
 * @param {string}  options.requestedByUsername  – Username who reacted
 * @returns {Object} Raw payload with flags and components
 */
function buildFlagTranslationContainer({
    flag,
    displayLanguage,
    translation,
    messageUrl,
    requestedByUsername,
}) {
    return {
        flags: FLAGS_COMPONENTS_V2,
        components: [
            {
                type: TYPE_CONTAINER,
                components: [
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `${flag} **${displayLanguage}**`,
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: translation.length > 1024
                            ? translation.substring(0, 1021) + '...'
                            : translation,
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `🔍 **Original:** [Jump to message](${messageUrl})`,
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `*Auto-deletes in 15 min • Requested by ${requestedByUsername}*`,
                    },
                ],
            },
        ],
    };
}

/**
 * Build a Components V2 Container for the vote-on-Top.gg prompt.
 *
 * @param {Object}  options
 * @param {string}  options.voteContent  – Translated vote message text
 * @param {string}  options.serverId     – Server ID for the vote button custom_id
 * @returns {Object} Raw payload with flags and components (ephemeral + V2)
 */
function buildVoteContainer({ voteContent, serverId }) {
    return {
        flags: FLAGS_COMPONENTS_V2 | 64, // ComponentsV2 | Ephemeral
        components: [
            {
                type: TYPE_CONTAINER,
                components: [
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: '🗳️ **Vote on Top.gg**',
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: voteContent,
                    },
                    {
                        type: TYPE_ACTION_ROW,
                        components: [
                            {
                                type: TYPE_BUTTON,
                                style: BUTTON_STYLE_PRIMARY,
                                label: '🗳️ Vote on Top.gg',
                                custom_id: `vote_choice_topgg:${serverId}`,
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

/**
 * Build a Components V2 Container for vote instructions (after clicking vote button).
 *
 * @param {Object}  options
 * @param {number}  options.bonus        – Number of free translations earned
 * @param {number}  options.delaySeconds – Seconds until reward is granted
 * @param {string}  options.siteName     – Site name (e.g. "Top.gg")
 * @param {string}  options.linkUrl      – URL to vote on the site
 * @returns {Object} Raw payload with flags and components (ephemeral + V2)
 */
function buildVoteInstructionsContainer({ bonus, delaySeconds, siteName, linkUrl }) {
    return {
        flags: FLAGS_COMPONENTS_V2 | 64, // ComponentsV2 | Ephemeral
        components: [
            {
                type: TYPE_CONTAINER,
                components: [
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: '🗳️ **Vote Instructions**',
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `We'll add **${bonus} free translations** to this server in about **${delaySeconds} seconds**.\nPlease complete the vote on ${siteName} in the meantime by clicking the button below 👇.`,
                    },
                    {
                        type: TYPE_ACTION_ROW,
                        components: [
                            {
                                type: TYPE_BUTTON,
                                style: BUTTON_STYLE_LINK,
                                label: `🔗 Open ${siteName}`,
                                url: linkUrl,
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

/**
 * Build a Components V2 Container for vote cooldown notice.
 *
 * @param {Object}  options
 * @param {string}  options.siteName – Site name (e.g. "Top.gg")
 * @param {number}  options.hours    – Hours remaining until cooldown expires
 * @returns {Object} Raw payload with flags and components (ephemeral + V2)
 */
function buildVoteCooldownContainer({ siteName, hours }) {
    return {
        flags: FLAGS_COMPONENTS_V2 | 64, // ComponentsV2 | Ephemeral
        components: [
            {
                type: TYPE_CONTAINER,
                components: [
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: '⏳ **Vote Cooldown Active**',
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `You have already voted on **${siteName}** for this server within the last 12 hours. You can claim vote rewards again in about **${hours} hour(s)**.`,
                    },
                ],
            },
        ],
    };
}

/**
 * Build a Components V2 Container for reward-already-pending notice.
 *
 * @param {Object}  options
 * @param {number}  options.minutes – Minutes remaining
 * @returns {Object} Raw payload with flags and components (ephemeral + V2)
 */
function buildRewardPendingContainer({ minutes }) {
    return {
        flags: FLAGS_COMPONENTS_V2 | 64, // ComponentsV2 | Ephemeral
        components: [
            {
                type: TYPE_CONTAINER,
                components: [
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: '⏳ **Reward Already Pending**',
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `A vote reward is already scheduled for this server. Please wait about **${minutes} minute(s)** before clicking again.`,
                    },
                ],
            },
        ],
    };
}

/**
 * Build a Components V2 Container for premium payment review.
 *
 * @param {Object}  options
 * @param {string}  options.description   – Translated premium description
 * @param {string}  options.serverName    – Server name
 * @param {string}  options.serverId      – Server ID
 * @param {string}  options.pricingUrl    – Tracked pricing URL
 * @returns {Object} Raw payload with flags and components (ephemeral + V2)
 */
function buildPremiumContainer({ description, serverName, serverId, pricingUrl }) {
    return {
        flags: FLAGS_COMPONENTS_V2 | 64, // ComponentsV2 | Ephemeral
        components: [
            {
                type: TYPE_CONTAINER,
                components: [
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: '💎 **Premium Payment Review**',
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: description,
                    },
                    {
                        type: TYPE_TEXT_DISPLAY,
                        content: `**Server:** ${serverName}\n**Server ID:** ${serverId}`,
                    },
                    {
                        type: TYPE_ACTION_ROW,
                        components: [
                            {
                                type: TYPE_BUTTON,
                                style: BUTTON_STYLE_LINK,
                                label: '💳 Payment',
                                url: pricingUrl,
                            },
                            {
                                type: TYPE_BUTTON,
                                style: BUTTON_STYLE_PRIMARY,
                                label: '✅ Confirm',
                                custom_id: `premium_request:${serverId}`,
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

module.exports = {
    buildAutoTranslationContainer,
    buildAutoTranslationButtons,
    buildFlagTranslationContainer,
    buildVoteContainer,
    buildVoteInstructionsContainer,
    buildVoteCooldownContainer,
    buildRewardPendingContainer,
    buildPremiumContainer,
    FLAGS_COMPONENTS_V2,
};
