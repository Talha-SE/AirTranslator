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

module.exports = {
    buildAutoTranslationContainer,
    buildAutoTranslationButtons,
    buildFlagTranslationContainer,
    FLAGS_COMPONENTS_V2,
};
