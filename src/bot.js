const { Client, GatewayIntentBits, Collection, EmbedBuilder, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, Partials, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { buildVoteContainer, buildVoteInstructionsContainer, buildVoteCooldownContainer, buildRewardPendingContainer, buildPremiumContainer } = require('./utils/translationCardBuilder');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const axios = require('axios');

const databaseService = require('./services/databaseService');
const analyticsService = require('./services/analyticsService');
const monetizationService = require('./services/monetizationService');
const translationQueueService = require('./services/translationQueueService');
const voteCheckService = require('./services/voteCheckService');
const { markServerAsNewlyJoined } = require('./services/unlimitedUsageCampaignService');
const { translateTextToMultipleLanguages, detectLanguage, translateText } = require('./services/mistralService');
const { AutoPoster } = require('topgg-autoposter');
require('dotenv').config();
const { AUTO_DETECT_LANGUAGE } = require('./utils/constants');

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

const TOPGG_VOTE_BONUS_AMOUNT = 30;
const PENDING_VOTE_TARGET_TTL_MS = 60 * 60 * 1000;
const TOPGG_CLICK_REWARD_DELAY_MS = 60 * 1000;

function trackTopggVoteTarget(userId, serverId) {
    if (!userId || !serverId) return;

    if (!global.pendingTopggVoteTargets) {
        global.pendingTopggVoteTargets = new Map();
    }

    const now = Date.now();
    const normalizedUserId = String(userId);
    const normalizedServerId = String(serverId);

    global.pendingTopggVoteTargets.set(normalizedUserId, {
        serverId: normalizedServerId,
        timestamp: now,
    });

    // Keep legacy map in sync for existing fallback logic in other modules.
    if (!global.userServerTracking) {
        global.userServerTracking = new Map();
    }
    global.userServerTracking.set(normalizedUserId, normalizedServerId);

    if (!global.pendingTopggVoteTargetsLastCleanup || now - global.pendingTopggVoteTargetsLastCleanup > PENDING_VOTE_TARGET_TTL_MS) {
        const cutoff = now - PENDING_VOTE_TARGET_TTL_MS;
        for (const [trackedUserId, entry] of global.pendingTopggVoteTargets.entries()) {
            if (!entry?.timestamp || entry.timestamp < cutoff) {
                global.pendingTopggVoteTargets.delete(trackedUserId);
            }
        }
        global.pendingTopggVoteTargetsLastCleanup = now;
    }
}

function scheduleTopggRewardAfterClick({ userId, serverId, bonusAmount, source = 'topgg', userInfo }) {
    if (!userId || !serverId) {
        return { scheduled: false, reason: 'missing_ids' };
    }

    if (!global.pendingTopggRewardTimers) {
        global.pendingTopggRewardTimers = new Map();
    }

    const key = `${String(userId)}:${String(serverId)}:${String(source)}`;
    const existing = global.pendingTopggRewardTimers.get(key);
    if (existing?.scheduledAt) {
        const elapsed = Date.now() - existing.scheduledAt;
        const remainingMs = Math.max(0, TOPGG_CLICK_REWARD_DELAY_MS - elapsed);
        return { scheduled: false, reason: 'already_pending', remainingMs };
    }

    const timer = setTimeout(async () => {
        try {
            const result = await monetizationService.handleVoteReward(
                String(userId),
                String(serverId),
                bonusAmount,
                userInfo,
                source
            );

            if (result?.success) {
                logger.success('Top.gg delayed reward granted from button click', { userId, serverId, bonusAmount, source });
                try {
                    await voteCheckService.sendVoteConfirmation(String(userId), String(serverId), bonusAmount);
                } catch (notifyError) {
                    logger.warn('Failed to send delayed reward confirmation', { error: notifyError?.message || notifyError, userId, serverId });
                }
            } else {
                logger.info('Top.gg delayed reward skipped from button click', {
                    userId,
                    serverId,
                    source,
                    reason: result?.message || result?.error || 'unknown',
                    onCooldown: !!result?.onCooldown,
                });
            }
        } catch (error) {
            logger.error('Top.gg delayed reward failed from button click', { error: error?.message || error, userId, serverId, source });
        } finally {
            if (global.pendingTopggRewardTimers) {
                global.pendingTopggRewardTimers.delete(key);
            }
        }
    }, TOPGG_CLICK_REWARD_DELAY_MS);

    global.pendingTopggRewardTimers.set(key, {
        scheduledAt: Date.now(),
        timer,
    });

    return { scheduled: true, key };
}

async function fetchTopGgBotStats(botId) {
  if (!botId || !process.env.TOPGG_TOKEN) {
    return null;
  }

  try {
    const { data } = await axios.get(`https://top.gg/api/bots/${botId}`, {
      headers: {
        Authorization: process.env.TOPGG_TOKEN,
      },
    });

    return {
      points: data?.points ?? null,
      monthlyPoints: data?.monthlyPoints ?? null,
      serverCount: data?.server_count ?? data?.serverCount ?? null,
    };
  } catch (error) {
    logger.debug('Top.gg stats fetch failed', { error: error?.message || error });
    return null;
  }
}

function buildTrackedPricingUrl({ serverId, serverName, userId, username, source = 'discord_payment_options_button' }) {
    const isDev = process.env.NODE_ENV !== 'production';
    const websiteBaseUrl = isDev ? 'http://localhost:5173' : 'https://airtranslator.brevios.com';
    const params = new URLSearchParams({
        source,
        origin: 'discord-bot',
        provider: 'patreon',
        medium: 'button',
        serverId: String(serverId || ''),
        serverName: String(serverName || ''),
        userId: String(userId || ''),
        username: String(username || ''),
        clickId: `clk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    });
    return `${websiteBaseUrl}/patreon-redirect?${params.toString()}`;
}

// Helper function to get language flag emoji
function getLanguageFlag(langCode) {
    const lang = langCode.toLowerCase();
    
    // Map of language codes and full names to flags
    const flags = {
        'en': '🇬🇧', 'english': '🇬🇧',
        'es': '🇪🇸', 'spanish': '🇪🇸',
        'fr': '🇫🇷', 'french': '🇫🇷',
        'de': '🇩🇪', 'german': '🇩🇪',
        'it': '🇮🇹', 'italian': '🇮🇹',
        'pt': '🇵🇹', 'portuguese': '🇵🇹',
        'ja': '🇯🇵', 'japanese': '🇯🇵',
        'ko': '🇰🇷', 'korean': '🇰🇷',
        'zh': '🇨🇳', 'chinese': '🇨🇳', 'chinese (simplified)': '🇨🇳', 'chinese (traditional)': '🇹🇼',
        'ru': '🇷🇺', 'russian': '🇷🇺',
        'ar': '🇸🇦', 'arabic': '🇸🇦',
        'hi': '🇮🇳', 'hindi': '🇮🇳',
        'tr': '🇹🇷', 'turkish': '🇹🇷',
        'nl': '🇳🇱', 'dutch': '🇳🇱',
        'pl': '🇵🇱', 'polish': '🇵🇱',
        'sv': '🇸🇪', 'swedish': '🇸🇪',
        'fi': '🇫🇮', 'finnish': '🇫🇮',
        'no': '🇳🇴', 'norwegian': '🇳🇴',
        'da': '🇩🇰', 'danish': '🇩🇰',
        'cs': '🇨🇿', 'czech': '🇨🇿',
        'el': '🇬🇷', 'greek': '🇬🇷',
        'he': '🇮🇱', 'hebrew': '🇮🇱',
        'th': '🇹🇭', 'thai': '🇹🇭',
        'vi': '🇻🇳', 'vietnamese': '🇻🇳',
        'id': '🇮🇩', 'indonesian': '🇮🇩',
        'ms': '🇲🇾', 'malay': '🇲🇾',
        'fil': '🇵🇭', 'filipino': '🇵🇭', 'tagalog': '🇵🇭',
        'uk': '🇺🇦', 'ukrainian': '🇺🇦',
        'ro': '🇷🇴', 'romanian': '🇷🇴',
        'hu': '🇭🇺', 'hungarian': '🇭🇺',
        'bg': '🇧🇬', 'bulgarian': '🇧🇬',
        'hr': '🇭🇷', 'croatian': '🇭🇷',
        'sr': '🇷🇸', 'serbian': '🇷🇸',
        'sk': '🇸🇰', 'slovak': '🇸🇰',
        'sl': '🇸🇮', 'slovenian': '🇸🇮',
        'et': '🇪🇪', 'estonian': '🇪🇪',
        'lv': '🇱🇻', 'latvian': '🇱🇻',
        'lt': '🇱🇹', 'lithuanian': '🇱🇹',
        'ur': '🇵🇰', 'urdu': '🇵🇰',
        'fa': '🇮🇷', 'persian': '🇮🇷',
        'bn': '🇧🇩', 'bengali': '🇧🇩',
        'ta': '🇮🇳', 'tamil': '🇮🇳',
        'te': '🇮🇳', 'telugu': '🇮🇳',
        'mr': '🇮🇳', 'marathi': '🇮🇳',
        'gu': '🇮🇳', 'gujarati': '🇮🇳',
        'kn': '🇮🇳', 'kannada': '🇮🇳',
        'ml': '🇮🇳', 'malayalam': '🇮🇳',
        'pa': '🇮🇳', 'punjabi': '🇮🇳',
        'af': '🇿🇦', 'afrikaans': '🇿🇦',
        'sq': '🇦🇱', 'albanian': '🇦🇱',
        'am': '🇪🇹', 'amharic': '🇪🇹',
        'hy': '🇦🇲', 'armenian': '🇦🇲',
        'az': '🇦🇿', 'azerbaijani': '🇦🇿',
        'eu': '🇪🇸', 'basque': '🇪🇸',
        'be': '🇧🇾', 'belarusian': '🇧🇾',
        'bs': '🇧🇦', 'bosnian': '🇧🇦',
        'ca': '🇪🇸', 'catalan': '🇪🇸',
        'ga': '🇮🇪', 'irish': '🇮🇪',
        'cy': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'welsh': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
        'ka': '🇬🇪', 'georgian': '🇬🇪',
        'is': '🇮🇸', 'icelandic': '🇮🇸',
        'mk': '🇲🇰', 'macedonian': '🇲🇰',
        'mn': '🇲🇳', 'mongolian': '🇲🇳',
        'ne': '🇳🇵', 'nepali': '🇳🇵',
        'ps': '🇦🇫', 'pashto': '🇦🇫',
        'sw': '🇰🇪', 'swahili': '🇰🇪'
    };
    return flags[lang] || '🌐';
}

// Helper function to get language display name
function getLanguageDisplayName(language) {
    const displayNames = {
        'afrikaans': 'Afrikaans', 'albanian': 'Albanian', 'amharic': 'Amharic', 'arabic': 'Arabic',
        'armenian': 'Armenian', 'azerbaijani': 'Azerbaijani', 'basque': 'Basque', 'belarusian': 'Belarusian',
        'bengali': 'Bengali', 'bosnian': 'Bosnian', 'bulgarian': 'Bulgarian', 'burmese': 'Burmese',
        'catalan': 'Catalan', 'cebuano': 'Cebuano', 'chinese': 'Chinese', 'chinese (simplified)': 'Chinese (Simplified)',
        'chinese (traditional)': 'Chinese (Traditional)', 'corsican': 'Corsican', 'croatian': 'Croatian',
        'czech': 'Czech', 'danish': 'Danish', 'dutch': 'Dutch', 'english': 'English',
        'esperanto': 'Esperanto', 'estonian': 'Estonian', 'filipino': 'Filipino', 'finnish': 'Finnish',
        'french': 'French', 'frisian': 'Frisian', 'galician': 'Galician', 'georgian': 'Georgian',
        'german': 'German', 'greek': 'Greek', 'gujarati': 'Gujarati', 'haitian': 'Haitian Creole',
        'hausa': 'Hausa', 'hawaiian': 'Hawaiian', 'hebrew': 'Hebrew', 'hindi': 'Hindi',
        'hmong': 'Hmong', 'hungarian': 'Hungarian', 'icelandic': 'Icelandic', 'igbo': 'Igbo',
        'indonesian': 'Indonesian', 'irish': 'Irish', 'italian': 'Italian', 'japanese': 'Japanese',
        'javanese': 'Javanese', 'kannada': 'Kannada', 'kazakh': 'Kazakh', 'khmer': 'Khmer',
        'kinyarwanda': 'Kinyarwanda', 'korean': 'Korean', 'kurdish': 'Kurdish', 'kyrgyz': 'Kyrgyz',
        'lao': 'Lao', 'latin': 'Latin', 'latvian': 'Latvian', 'lithuanian': 'Lithuanian',
        'luxembourgish': 'Luxembourgish', 'macedonian': 'Macedonian', 'malagasy': 'Malagasy', 'malay': 'Malay',
        'malayalam': 'Malayalam', 'maltese': 'Maltese', 'maori': 'Maori', 'marathi': 'Marathi',
        'mongolian': 'Mongolian', 'myanmar': 'Myanmar', 'nepali': 'Nepali', 'norwegian': 'Norwegian',
        'odia': 'Odia', 'pashto': 'Pashto', 'persian': 'Persian', 'polish': 'Polish',
        'portuguese': 'Portuguese', 'punjabi': 'Punjabi', 'romanian': 'Romanian', 'russian': 'Russian',
        'samoan': 'Samoan', 'scots gaelic': 'Scots Gaelic', 'serbian': 'Serbian', 'sesotho': 'Sesotho',
        'shona': 'Shona', 'sindhi': 'Sindhi', 'sinhala': 'Sinhala', 'slovak': 'Slovak',
        'slovenian': 'Slovenian', 'somali': 'Somali', 'spanish': 'Spanish', 'sundanese': 'Sundanese',
        'swahili': 'Swahili', 'swedish': 'Swedish', 'tagalog': 'Tagalog', 'tajik': 'Tajik',
        'tamil': 'Tamil', 'tatar': 'Tatar', 'telugu': 'Telugu', 'thai': 'Thai',
        'turkish': 'Turkish', 'turkmen': 'Turkmen', 'ukrainian': 'Ukrainian', 'urdu': 'Urdu',
        'uyghur': 'Uyghur', 'uzbek': 'Uzbek', 'vietnamese': 'Vietnamese', 'welsh': 'Welsh',
        'xhosa': 'Xhosa', 'yiddish': 'Yiddish', 'yoruba': 'Yoruba', 'zulu': 'Zulu'
    };
    return displayNames[language.toLowerCase()] || language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
}

// Helper function to translate premium payment message into server languages
async function translatePremiumMessage(serverId) {
    let hasServerSetup = false;
    let languageCount = 0;

    try {
        const originalText = `✨ Unlock Full Access – Only $5/month ✨\n\nFollow these simple steps:\n1. Click the card button (💳) below or open the Patreon link: https://www.patreon.com/c/tsio/membership\n2. Subscribe to the membership plan you like.\n3. Come back to this Discord server and click the tick button (✅) to request approval.\n4. Type /premium to see your premium details.\n\nYour subscription is securely handled by Patreon.com, and we do not process your payment details directly.\n\nYou will get a notification when your premium plan is enabled.`;
        
        // Get server setup to find configured languages
        const serverSetup = await databaseService.getServerSetups(serverId);
        if (!serverSetup) {
            return originalText; // No setup, return English only
        }
        hasServerSetup = true;
        
        // Collect all unique languages from server setups and server-wide translation
        const allLanguages = new Set();
        
        // Add server-wide languages if enabled
        if (serverSetup.serverWideTranslation && serverSetup.serverWideLanguages) {
            serverSetup.serverWideLanguages.forEach(lang => {
                if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                    allLanguages.add(lang.toLowerCase());
                }
            });
        }
        
        // Add languages from all channel setups
        if (serverSetup.setups && serverSetup.setups.length > 0) {
            serverSetup.setups.forEach(setup => {
                if (setup.languages && Array.isArray(setup.languages)) {
                    setup.languages.forEach(lang => {
                        if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                            allLanguages.add(lang.toLowerCase());
                        }
                    });
                }
            });
        }
        
        // Collect non-English languages for translation (filter out both 'en' code and 'english' full name)
        const targetLanguages = Array.from(allLanguages).filter(lang => lang !== 'en' && lang !== 'english');
        languageCount = targetLanguages.length;
        
        // If no other languages configured, return original English only
        if (targetLanguages.length === 0) {
            return originalText;
        }
        
        // Translate to all non-English configured languages using medium model
        const translations = await translateTextToMultipleLanguages(
            originalText,
            targetLanguages,
            'en',
            false,
            undefined,
            'mistral-medium-2508',
            'premium-button',
            { forceEscapedLineBreaks: true }
        );
        
        // Format with language labels
        const formattedParts = [];
        
        // Add English first
        formattedParts.push(`🇬🇧 **English (Default):**\n${originalText}`);
        
        // Add other languages
        for (const lang of targetLanguages) {
            const translation = translations[lang];
            if (translation && translation.trim()) {
                const langFlag = getLanguageFlag(lang);
                const langName = getLanguageDisplayName(lang);
                formattedParts.push(`${langFlag} **${langName}:**\n${translation}`);
            }
        }

        if (formattedParts.length === 1) {
            return originalText;
        }
        
        return formattedParts.join('\n\n');
    } catch (error) {
        logger.error('Error translating premium message', {
            error: error?.message || error,
            stack: error?.stack,
            serverId,
            hasServerSetup,
            apiKeyPresent: !!process.env.MISTRAL_API_KEY,
            languageCount
        });
        // Fallback to English on error
        return `✨ Unlock Full Access – Only $5/month ✨\n\nFollow these simple steps:\n1. Click the card button (💳) below or open the Patreon link: https://www.patreon.com/c/tsio/membership\n2. Subscribe to the membership plan you like.\n3. Come back to this Discord server and click the tick button (✅) to request approval.\n4. Type /premium to see your premium details.\n\nYour subscription is securely handled by Patreon.com, and we do not process your payment details directly.\n\nYou will get a notification when your premium plan is enabled.`;
    }
}

// Helper function to translate vote message into server languages
async function translateVoteMessage(serverId) {
    let hasServerSetup = false;
    let languageCount = 0;

    try {
        const bonusAmount = monetizationService.getVoteBonusAmount();
        const originalText = `Select where you want to vote to support Air Translator:

🔵 Vote on Top.gg
Get ${bonusAmount} free translations by clicking the button below.
You'll be redirected to the Top.gg bot page 🚀`;
        
        // Get server setup to find configured languages
        const serverSetup = await databaseService.getServerSetups(serverId);
        if (!serverSetup) {
            return originalText; // No setup, return English only
        }
        hasServerSetup = true;
        
        // Collect all unique languages from server setups and server-wide translation
        const allLanguages = new Set();
        
        // Add server-wide languages if enabled
        if (serverSetup.serverWideTranslation && serverSetup.serverWideLanguages) {
            serverSetup.serverWideLanguages.forEach(lang => {
                if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                    allLanguages.add(lang.toLowerCase());
                }
            });
        }
        
        // Add languages from individual channel setups
        if (serverSetup.setups && serverSetup.setups.length > 0) {
            serverSetup.setups.forEach(setup => {
                if (setup.languages && Array.isArray(setup.languages)) {
                    setup.languages.forEach(lang => {
                        if (lang && lang !== AUTO_DETECT_LANGUAGE) {
                            allLanguages.add(lang.toLowerCase());
                        }
                    });
                }
            });
        }
        
        // Collect non-English languages for translation (filter out both 'en' code and 'english' full name)
        const targetLanguages = Array.from(allLanguages).filter(lang => lang !== 'en' && lang !== 'english');
        languageCount = targetLanguages.length;
        
        // If no other languages configured, return original English only
        if (targetLanguages.length === 0) {
            return originalText;
        }
        
        // Translate to all non-English configured languages using medium model
        const translations = await translateTextToMultipleLanguages(
            originalText,
            targetLanguages,
            'en',
            false,
            undefined,
            'mistral-medium-2508',
            'vote-button',
            { forceEscapedLineBreaks: true }
        );
        
        // Format with language labels
        const formattedParts = [];
        
        // Add English first
        formattedParts.push(`🇬🇧 **English (Default):**\n${originalText}`);
        
        // Add other languages
        for (const lang of targetLanguages) {
            const translation = translations[lang];
            if (translation && translation.trim()) {
                const langFlag = getLanguageFlag(lang);
                const langName = getLanguageDisplayName(lang);
                formattedParts.push(`${langFlag} **${langName}:**\n${translation}`);
            }
        }

        if (formattedParts.length === 1) {
            return originalText;
        }
        
        return formattedParts.join('\n\n');
    } catch (error) {
        logger.error('Error translating vote message', {
            error: error?.message || error,
            stack: error?.stack,
            serverId,
            hasServerSetup,
            apiKeyPresent: !!process.env.MISTRAL_API_KEY,
            languageCount
        });
        // Fallback to English on error
        const fallbackAmount = monetizationService.getVoteBonusAmount();
        return `Select where you want to vote to support Air Translator:

🔵 Vote on Top.gg
Get ${fallbackAmount} free translations by clicking the button below.
You'll be redirected to the Top.gg bot page 🚀`;
    }
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
    ],
    partials: [
        Partials.Message,
        Partials.Channel, 
        Partials.Reaction,
        Partials.User
    ]
});

// Make client globally available for admin panel
global.discordClient = client;

// Ephemeral state for guided autosetup per user per guild
global.autoSetupState = new Map(); // key: `${guildId}:${userId}` -> { channelIds: string[] }

// Set up commands collection
client.commands = new Collection();

// Load commands
const quickSetupCommand = require('./commands/quickSetup');
const autoSetupCommand = require('./commands/autoSetup');
const addChannelCommand = require('./commands/addChannel');
const removeChannelCommand = require('./commands/removeChannel');
const listSetupsCommand = require('./commands/listSetups');
const deleteSetupCommand = require('./commands/deleteSetup');
const toggleToneCommand = require('./commands/toggleTone');
const globalModeCommand = require('./commands/globalmode');
const helpCommand = require('./commands/help');
const voteStatusCommand = require('./commands/votestatus');
const premiumCommand = require('./commands/premium');
const flagsCommand = require('./commands/flags');
const autoCleanupCommand = require('./commands/autoCleanup');
const personalBuddyCommand = require('./commands/personalBuddy');
const styleCommand = require('./commands/style');
const translateToMyDMsCommand = require('./commands/translateToMyDMs');
const pbEnableCommand = require('./commands/pbEnable');
const pbDisableCommand = require('./commands/pbDisable');
const pbSetLanguagesCommand = require('./commands/pbSetLanguages');
const speechToTextCommand = require('./commands/speechToText');
const callCommand = require('./commands/call');
const translateMessageCommand = require('./commands/translateMessage');

client.commands.set('quicksetup', quickSetupCommand);
client.commands.set('autosetup', autoSetupCommand);
client.commands.set('addchannel', addChannelCommand);
client.commands.set('removechannel', removeChannelCommand);
client.commands.set('listsetups', listSetupsCommand);
client.commands.set('deletesetup', deleteSetupCommand);
client.commands.set('toggletone', toggleToneCommand);
client.commands.set('globalmode', globalModeCommand);
client.commands.set('help', helpCommand);
client.commands.set('votestatus', voteStatusCommand);
client.commands.set('premium', premiumCommand);
client.commands.set('flags', flagsCommand);
client.commands.set('autocleanup', autoCleanupCommand);
client.commands.set('personalbuddy', personalBuddyCommand);
client.commands.set('style', styleCommand);
// Register message context menu command by its exact name
client.commands.set(translateToMyDMsCommand.data.name, translateToMyDMsCommand);
// Register user context menu commands for Personal Buddy
client.commands.set(pbEnableCommand.data.name, pbEnableCommand);
client.commands.set(pbDisableCommand.data.name, pbDisableCommand);
client.commands.set(pbSetLanguagesCommand.data.name, pbSetLanguagesCommand);
client.commands.set('speechtotext', speechToTextCommand);
client.commands.set('call', callCommand);
client.commands.set(translateMessageCommand.data.name, translateMessageCommand);

// Load events
const ready = require('./events/ready');
const messageCreate = require('./events/messageCreate');
const messageUpdate = require('./events/messageUpdate');
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

client.on('messageUpdate', (oldMessage, newMessage) => {
    // Only process if content actually changed
    if (oldMessage.content === newMessage.content) return;
    messageUpdate(client, newMessage);
});

client.on('messageReactionAdd', (reaction, user) => {
    messageReactionAdd(client, reaction, user);
});

client.on('guildDelete', (guild) => {
    guildDelete(guild);
    // Update server list when bot leaves a server
    analyticsService.updateServerList(client);
});

// Reactively check for STT auto-resume when voice states change
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        // Use the dedicated voice state handler if available
        if (typeof speechToTextCommand?.handleVoiceStateUpdate === 'function') {
            await speechToTextCommand.handleVoiceStateUpdate(client, oldState, newState);
        } else if (typeof speechToTextCommand?.resumeIfNeeded === 'function') {
            // Fallback to resumeIfNeeded
            const guild = newState?.guild || oldState?.guild;
            if (guild) {
                await speechToTextCommand.resumeIfNeeded(client, guild);
            }
        }
    } catch (e) {
        logger.debug('[STT] voiceStateUpdate handler failed', { error: e?.message });
    }

    // VCT auto-join/leave
    try {
        const guild = newState?.guild || oldState?.guild;
        if (!guild) return;

        const VoiceCallTranslation = require('./models/VoiceCallTranslation');
        const Server = require('./models/Server');
        const voiceCallTranslationService = require('./services/voiceCallTranslationService');

        const vctSettings = await VoiceCallTranslation.findOne({ guildId: guild.id }).lean();
        if (!vctSettings || !vctSettings.enabled || !vctSettings.voiceChannelId) return;

        const targetChannelId = vctSettings.voiceChannelId;
        const userJoined = newState.channelId === targetChannelId && oldState.channelId !== targetChannelId;
        const userLeft = oldState.channelId === targetChannelId && newState.channelId !== targetChannelId;

        if (!userJoined && !userLeft) return;

        // Skip bots
        const member = userJoined ? newState.member : oldState.member;
        if (member?.user?.bot) return;

        const voiceChannel = guild.channels.cache.get(targetChannelId);
        if (!voiceChannel) return;

        const humanMembers = voiceChannel.members.filter(m => !m.user.bot);

        if (userJoined && humanMembers.size === 1) {
            // First human user joined — auto-start VCT if not already active
            if (voiceCallTranslationService.isTranslationActive(guild.id)) return;

            const serverDoc = await Server.findOne({ serverId: guild.id }).lean();
            const isPremium = serverDoc?.monetization?.isExempt === true;

            // Check daily free limit for non-premium
            let remainingMinutes = null;
            if (!isPremium) {
                const now = new Date();
                const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
                let vctDoc = await VoiceCallTranslation.findOne({ guildId: guild.id });
                if (vctDoc) {
                    if (vctDoc.dailyUsageDate !== today) {
                        vctDoc.dailyMinutesUsed = 0;
                        vctDoc.dailyUsageDate = today;
                        await vctDoc.save();
                    }
                    if (vctDoc.dailyMinutesUsed >= 60) {
                        logger.info(`[VCT Auto-Join] ⏰ Free limit reached for guild ${guild.id} — skipping auto-start`);
                        return;
                    }
                    remainingMinutes = 60 - vctDoc.dailyMinutesUsed;
                }
            }

            logger.info(`[VCT Auto-Join] 🎤 First user joined — auto-starting VCT in "${voiceChannel.name}" (${guild.name})`);

            await voiceCallTranslationService.startTranslation(
                guild.id,
                targetChannelId,
                vctSettings.sourceLanguage || 'auto',
                vctSettings.targetLanguage,
                vctSettings.model || 'gemini-3.1-flash-live-preview',
                client,
                vctSettings.voice || 'Aoede',
                remainingMinutes
            );
        }

        if (userLeft && humanMembers.size === 0) {
            // Last human user left — auto-stop VCT
            if (!voiceCallTranslationService.isTranslationActive(guild.id)) return;

            logger.info(`[VCT Auto-Leave] 🔇 Channel empty — auto-stopping VCT (${guild.name})`);
            await voiceCallTranslationService.stopTranslation(guild.id, client);
        }
    } catch (e) {
        logger.debug('[VCT] voiceStateUpdate handler failed', { error: e?.message });
    }
});

// Periodic check for voice channel presence
setInterval(async () => {
    try {
        const guilds = client.guilds.cache;
        for (const guild of guilds.values()) {
            const [sttSettings, vctSettings] = await Promise.all([
                require('./models/STTSettings').findOne({ guildId: guild.id, enabled: true }).lean(),
                require('./models/VoiceCallTranslation').findOne({ guildId: guild.id }).lean()
            ]);
            const connection = getVoiceConnection(guild.id);
            
            // No connection exists for this guild - nothing to check
            if (!connection) continue;
            
            // Check if VCT is currently active (bot is in a voice channel for VCT)
            const { isTranslationActive } = require('./services/voiceCallTranslationService');
            const vctActive = isTranslationActive(guild.id);
            
            // Case 1: VCT is actively running - keep connection alive
            if (vctActive) {
                logger.info('[PeriodicCheck] ✅ VCT active - keeping voice connection alive', { guildId: guild.id });
                continue;
            }
            
            // Case 2: STT is enabled and connected - keep alive (STT manages its own lifecycle)
            if (sttSettings?.enabled && connection) {
                logger.info('[PeriodicCheck] ✅ STT enabled - keeping voice connection alive', { guildId: guild.id });
                continue;
            }
            
            // Case 3: Orphaned connection - no active STT or VCT, destroy it
            const vctConfigured = vctSettings?.enabled && vctSettings?.voiceChannelId;
            let reason = vctConfigured ? 'VCT configured but not started' : 'no STT or VCT is active';
            
            connection.destroy();
            logger.info('[PeriodicCheck] 🗑️ Left voice channel - ' + reason, { guildId: guild.id });
        }
    } catch (error) {
        logger.error('Periodic voice check error:', error?.message);
    }
}, 60000); // Check every 60 seconds

// Periodic STT auto-resume (every 60 seconds)
setInterval(async () => {
    try {
        if (!speechToTextCommand || typeof speechToTextCommand.resumeIfNeeded !== 'function') return;
        for (const guild of client.guilds.cache.values()) {
            await speechToTextCommand.resumeIfNeeded(client, guild);
        }
    } catch (e) {
        logger.debug('[STT] periodic resumeIfNeeded error', { error: e?.message || e });
    }
}, 60000).unref();

client.on('guildCreate', async (guild) => {
    logger.success(`Joined new server: ${guild.name}`);

    try {
        await markServerAsNewlyJoined(guild);
    } catch (error) {
        logger.warn('Failed to mark server as newly joined for auto campaign', {
            guildId: guild.id,
            guildName: guild.name,
            error: error?.message || error
        });
    }
    
    try {
        const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
        const canSendToChannel = (candidate) => {
            if (!candidate || candidate.type !== ChannelType.GuildText) {
                return false;
            }
            const perms = candidate.permissionsFor(botMember ?? client.user);
            return perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'], true) ?? false;
        };

        const channel = [
            guild.systemChannel,
            ...guild.channels.cache
                .filter((ch) => ch.type === ChannelType.GuildText)
                .sort((a, b) => a.rawPosition - b.rawPosition)
        ].find(canSendToChannel);

        if (!channel) {
            logger.warn('No welcome channel with send permissions found', { guildId: guild.id, guildName: guild.name });
            return;
        }
        
        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🌍 Air Translator Ready!')
            .setDescription('Break language barriers instantly! You can now manage your entire server translation settings from our modern web dashboard.')
            .addFields(
                { name: '🚀 Quick Start', value: 'Managing your server is now easier than ever. Click the button below to open the dashboard.' },
                { name: '⌨️ Commands', value: 'Prefer commands? Use `/help` to see all available slash commands.' }
            )
            .setFooter({ text: 'Empower your global community today! 🌍✨' })
            .setTimestamp();

        const dashboardButton = new ButtonBuilder()
            .setLabel('Open Dashboard')
            .setURL('https://airtranslator.brevios.com/dashboard')
            .setStyle(ButtonStyle.Link);

        const supportButton = new ButtonBuilder()
            .setLabel('Support Server')
            .setURL('https://discord.gg/your-support-link') // Note: Update this if you have a specific support link
            .setStyle(ButtonStyle.Link);

        const actionRow = new ActionRowBuilder().addComponents(dashboardButton, supportButton);
            
        await channel.send({ 
            embeds: [welcomeEmbed],
            components: [actionRow]
        });

        // Optional: Keep the interactive AutoSetup for those who want to stay in Discord
        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('autosetup_channels')
            .setPlaceholder('Select 1-5 channels for auto-setup')
            .setMinValues(1)
            .setMaxValues(5)
            .setChannelTypes([ChannelType.GuildText, ChannelType.GuildVoice]);

        const controlsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('autosetup_continue').setLabel('Continue ▶').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('autosetup_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );

        const selectRow = new ActionRowBuilder().addComponents(channelSelect);

        await channel.send({
            content: '**Prefer in-Discord setup?** Use the menu below:',
            components: [selectRow, controlsRow]
        });
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
    } else if (interaction.isMessageContextMenuCommand() || interaction.isUserContextMenuCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            logger.warn(`No context menu command matching ${interaction.commandName} was found.`);
            return;
        }
        try {
            await command.execute(interaction);
        } catch (error) {
            logger.error(`Error executing context menu ${interaction.commandName}`, error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this action!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this action!', flags: MessageFlags.Ephemeral });
                }
            } catch (err) {
                logger.error('Error handling context menu error', err);
            }
        }
    } else if (interaction.isChannelSelectMenu()) {
        try {
            if (interaction.customId === 'autosetup_channels') {
                const key = `${interaction.guildId}:${interaction.user.id}`;
                const channelIds = interaction.values || [];
                global.autoSetupState.set(key, { channelIds });
                await interaction.reply({ content: `✅ Saved ${channelIds.length} channel(s). Click Continue to proceed.`, flags: MessageFlags.Ephemeral });
                return;
            }
        } catch (_) { /* ignore */ }
    } else if (interaction.isButton()) {
        try {
            const customId = interaction.customId || '';
            // Debug log to trace unknown button issues
            logger.debug('[Button] Received button interaction', { customId, inGuild: interaction.inGuild(), userId: interaction.user?.id });

            // Guided Auto Setup flow buttons
            if (customId === 'autosetup_continue') {
                const key = `${interaction.guildId}:${interaction.user.id}`;
                const state = global.autoSetupState.get(key);
                if (!state?.channelIds?.length) {
                    await interaction.reply({ content: '⚠️ Please select at least one channel using the selector above before continuing.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const modal = new ModalBuilder()
                    .setCustomId('autosetup_langs')
                    .setTitle('Select Target Languages');
                const input = new TextInputBuilder()
                    .setCustomId('autosetup_langs_input')
                    .setLabel('Enter languages (comma separated)')
                    .setPlaceholder('e.g., Spanish, French, German')
                    .setRequired(true)
                    .setStyle(TextInputStyle.Paragraph);
                const row = new ActionRowBuilder().addComponents(input);
                modal.addComponents(row);
                await interaction.showModal(modal);
                return;
            }

            if (customId === 'autosetup_cancel') {
                const key = `${interaction.guildId}:${interaction.user.id}`;
                global.autoSetupState.delete(key);
                await interaction.reply({ content: '❎ Auto setup canceled. You can run it anytime with `/autosetup`.', flags: MessageFlags.Ephemeral });
                return;
            }

            // Handle Vote Button Click -> Show Top.gg Option
            if (customId.startsWith('vote_on_topgg')) {
                try {
                    // Defer reply immediately to prevent timeout
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    
                    // Extract serverId if provided after ':' else fallback to recent mapping or current guild
                    let serverId = customId.includes(':') ? customId.split(':')[1] : null;
                    if (!serverId && global.userServerTracking && interaction.user) {
                        serverId = global.userServerTracking.get(interaction.user.id) || null;
                    }
                    if (!serverId) serverId = interaction.guildId || null;

                    if (!serverId) {
                        await interaction.editReply({
                            content: '❌ Could not determine the target server. Please click this button from within your server.'
                        });
                        return;
                    }

                    trackTopggVoteTarget(interaction.user?.id, serverId);

                    // Get translated vote message
                    const voteContent = await translateVoteMessage(serverId);

                    const votePayload = buildVoteContainer({ voteContent, serverId });

                    await interaction.editReply(votePayload);
                } catch (err) {
                    logger.warn('vote_on_topgg handler error', { error: err?.message || err });
                    try {
                        await interaction.editReply({ content: '❌ Error showing vote prompt.' });
                    } catch {}
                }
                return;
            }

            // Handle Vote Choice (Top.gg only)
            if (customId.startsWith('vote_choice_topgg')) {
                try {
                    const source = 'topgg';
                    const BONUS = monetizationService.getVoteBonusAmount();
                    const SITE_NAME = 'Top.gg';
                    const DELAY_MS = TOPGG_CLICK_REWARD_DELAY_MS;
                    
                    let serverId = customId.includes(':') ? customId.split(':')[1] : null;
                    if (!serverId && global.userServerTracking && interaction.user) {
                        serverId = global.userServerTracking.get(interaction.user.id) || null;
                    }
                    if (!serverId) serverId = interaction.guildId || null;

                    if (!serverId) {
                        await interaction.reply({ content: '❌ Could not determine the target server.', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    trackTopggVoteTarget(interaction.user?.id, serverId);

                    // Check cooldown before showing the link (per server)
                    console.log(`🗳️ Checking vote cooldown for user ${interaction.user.id} on server ${serverId} (${source})`);
                    const canVote = await monetizationService.canUserVote(interaction.user.id, serverId, source);
                    
                    if (!canVote) {
                        const remainingTime = await monetizationService.getUserCooldownRemaining(interaction.user.id, serverId, source);
                        const hrs = Math.ceil(remainingTime / (60 * 60 * 1000));
                        console.log(`⏳ Showing cooldown message to user ${interaction.user.id}: ${hrs} hours remaining`);
                        
                        await interaction.reply(buildVoteCooldownContainer({ siteName: SITE_NAME, hours: hrs }));
                        return;
                    }
                    
                    console.log(`✅ User ${interaction.user.id} can vote on server ${serverId} (${source})`);

                    const scheduleResult = scheduleTopggRewardAfterClick({
                        userId: interaction.user.id,
                        serverId,
                        bonusAmount: BONUS,
                        source,
                        userInfo: {
                            id: interaction.user.id,
                            username: interaction.user.username,
                            displayName: interaction.user.displayName || interaction.user.username,
                            displayAvatarURL: () => interaction.user.displayAvatarURL(),
                        },
                    });

                    if (!scheduleResult.scheduled && scheduleResult.reason === 'already_pending') {
                        const pendingMins = Math.ceil((scheduleResult.remainingMs || 0) / 60000) || 1;
                        await interaction.reply(buildRewardPendingContainer({ minutes: pendingMins }));
                        return;
                    }

                    const linkUrl = `https://top.gg/bot/1380177061032759416/vote?guild=${serverId}`;

                    const instructionsPayload = buildVoteInstructionsContainer({
                        bonus: BONUS,
                        delaySeconds: Math.floor(DELAY_MS / 1000),
                        siteName: SITE_NAME,
                        linkUrl,
                    });

                    await interaction.reply(instructionsPayload);

                } catch (err) {
                    logger.warn('vote choice handler error', { error: err?.message || err });
                    try {
                        await interaction.reply({
                            content: '❌ Something went wrong while processing your vote reward. Please try again later.',
                            flags: MessageFlags.Ephemeral
                        });
                    } catch {}
                }
                return;
            }

            // Handle payment options -> show review message and approval button
            if (customId.startsWith('see_payment_options')) {
                try {
                    // Defer reply immediately to prevent timeout
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    
                    let serverId = customId.includes(':') ? customId.split(':')[1] : null;
                    if (!serverId && global.userServerTracking && interaction.user) {
                        serverId = global.userServerTracking.get(interaction.user.id) || null;
                    }
                    if (!serverId) serverId = interaction.guildId || 'unknown';

                    const serverName = interaction.guild?.name || 'This server';
                    const trackedPricingUrl = buildTrackedPricingUrl({
                        serverId,
                        serverName,
                        userId: interaction.user?.id,
                        username: interaction.user?.username,
                        source: 'discord_payment_options_button'
                    });

                    // Get translated description based on server languages
                    const translatedDescription = await translatePremiumMessage(serverId);

                    const premiumPayload = buildPremiumContainer({
                        description: translatedDescription,
                        serverName,
                        serverId,
                        pricingUrl: trackedPricingUrl,
                    });

                    await interaction.editReply(premiumPayload);
                } catch (err) {
                    logger.warn('see_payment_options handler error', { error: err?.message || err });
                    try {
                        await interaction.editReply({
                            content: '❌ Could not display payment options. Please try again later or contact support.'
                        });
                    } catch {}
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

                const embed = new EmbedBuilder()
                    .setColor('#00ff88') // Vibrant green for success
                    .setTitle('💎 Premium Request Recorded')
                    .setDescription('Your premium payment review request has been successfully received.')
                    .addFields(
                        { name: '📍 Server', value: `**${serverName}**`, inline: true },
                        { name: '🆔 Request ID', value: `\`${created?._id || 'N/A'}\``, inline: true },
                        { name: '⏳ Next Step', value: 'Our team will review your payment and approve premium status for your server shortly.', inline: false }
                    )
                    .setFooter({ text: 'Air Translator • Confirmation', iconURL: interaction.client.user.displayAvatarURL() })
                    .setTimestamp();

                // Notify admin(s) immediately in the background
                (async () => {
                    try {
                        const adminUserId = process.env.ADMIN_NOTIFY_USER_ID;
                        const adminGuildId = process.env.ADMIN_NOTIFY_GUILD_ID;
                        const adminChannelId = process.env.ADMIN_NOTIFY_CHANNEL_ID;

                        const adminEmbed = new EmbedBuilder()
                            .setColor('#f59e0b')
                            .setTitle('📥 New Premium Review Request')
                            .setDescription('A server has requested premium payment review.')
                            .addFields(
                                { name: 'Server', value: `${serverName} (${serverId})`, inline: false },
                                { name: 'Requester', value: `${requester.displayName || requester.username} (${requester.id})`, inline: false },
                                { name: 'Request ID', value: `${created?._id || 'N/A'}`, inline: false }
                            )
                            .setTimestamp(new Date())
                            .setFooter({ text: 'Air Translator • Admin Alert' });

                        // Attach Approve/Reject buttons for quick handling in admin DM/channel
                        const adminComponents = [];
                        if (created?._id) {
                            const row = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`premium_approve:${created._id.toString()}`)
                                    .setLabel('Approve')
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`premium_reject:${created._id.toString()}`)
                                    .setLabel('Reject')
                                    .setStyle(ButtonStyle.Danger)
                            );
                            adminComponents.push(row);
                        }

                        // DM the admin user, if configured
                        if (adminUserId && client) {
                            try {
                                const adminUser = await client.users.fetch(adminUserId);
                                if (adminUser) {
                                    await adminUser.send({ embeds: [adminEmbed], components: adminComponents }).catch(async () => {
                                        await adminUser.send(`New premium request: ${serverName} (${serverId}) by ${requester.displayName || requester.username} (${requester.id})\nRequest ID: ${created?._id || 'N/A'}`);
                                    });
                                }
                            } catch (e) {
                                logger.warn('Failed to DM admin for premium request', { error: e?.message || e });
                            }
                        }

                        // Post to an admin channel if provided
                        if (client && (adminChannelId || adminGuildId)) {
                            try {
                                let targetChannel = null;
                                if (adminChannelId) {
                                    try {
                                        targetChannel = await client.channels.fetch(adminChannelId);
                                    } catch {}
                                }
                                if (!targetChannel && adminGuildId) {
                                    try {
                                        const g = await client.guilds.fetch(adminGuildId);
                                        if (g) {
                                            targetChannel = g.systemChannel || g.channels.cache.find(c => c.type === 0 && /general|chat|announce/i.test(c.name));
                                            if (!targetChannel) targetChannel = g.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user)?.has(['SendMessages','EmbedLinks']));
                                        }
                                    } catch {}
                                }
                                if (targetChannel && targetChannel.permissionsFor(client.user)?.has(['SendMessages'])) {
                                    if (targetChannel.permissionsFor(client.user)?.has(['EmbedLinks'])) {
                                        await targetChannel.send({ embeds: [adminEmbed], components: adminComponents });
                                    } else {
                                        await targetChannel.send(`New premium request: ${serverName} (${serverId}) by ${requester.displayName || requester.username} (${requester.id})\nRequest ID: ${created?._id || 'N/A'}`);
                                    }
                                }
                            } catch (e) {
                                logger.warn('Failed to send admin channel alert for premium request', { error: e?.message || e });
                            }
                        }
                    } catch (_) { /* non-fatal */ }
                })();
                if (interaction.inGuild()) {
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ embeds: [embed] });
                }
                return;
            }

            // Handle Broadcast Translate button — show flag buttons for server languages
            if (customId === 'translate_broadcast') {
                try {
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    const guildId = interaction.guildId;
                    const messageId = interaction.message?.id;

                    if (!guildId || !messageId) {
                        await interaction.editReply({ content: '❌ Could not identify this message.' });
                        return;
                    }

                    // Get original content from the broadcast message
                    let broadcastData = global.broadcastMessages?.get(messageId);
                    if (!broadcastData) {
                        // Fetch the original broadcast message from the channel
                        try {
                            const originalMsg = await interaction.channel.messages.fetch(messageId);
                            const embed = originalMsg.embeds?.[0];
                            broadcastData = {
                                title: embed?.title || null,
                                content: embed?.description || originalMsg.content || null,
                                imageUrl: embed?.image?.url || null,
                                guildId: guildId
                            };
                        } catch {}
                    }
                    if (!broadcastData?.content) {
                        await interaction.editReply({ content: '❌ Could not read this message content.' });
                        return;
                    }

                    // Get server's configured languages
                    const Server = require('./models/Server');
                    const serverDoc = await Server.findOne({ serverId: guildId }).lean();
                    
                    let languages = [];
                    if (serverDoc) {
                        if (serverDoc.serverWideLanguages?.length) {
                            languages.push(...serverDoc.serverWideLanguages);
                        }
                        if (serverDoc.setups?.length) {
                            for (const setup of serverDoc.setups) {
                                if (setup.languages?.length) {
                                    languages.push(...setup.languages);
                                }
                            }
                        }
                        languages = [...new Set(languages.map(l => l.toLowerCase().trim()))];
                    }

                    if (!languages.length) {
                        await interaction.editReply({ content: '❌ No translation languages configured for this server. Server admins can set languages with `/quicksetup`.' });
                        return;
                    }

                    const translateLangs = languages.filter(l => l !== 'auto' && l !== 'english');

                    if (!translateLangs.length) {
                        await interaction.editReply({ content: '❌ No target languages available for translation.' });
                        return;
                    }

                    // Build ephemeral message using V2 Container (mirror original structure)
                    const flagButtons = [];
                    const flagLangs = translateLangs.slice(0, 15);

                    for (let i = 0; i < flagLangs.length; i += 5) {
                        const row = { type: 1, components: [] };
                        for (const lang of flagLangs.slice(i, i + 5)) {
                            const flag = getLanguageFlag(lang);
                            row.components.push({
                                type: 2,
                                custom_id: `tfl:${guildId}:${messageId}:${lang}`,
                                label: flag,
                                style: 2 // Secondary
                            });
                        }
                        flagButtons.push(row);
                    }

                    // Build V2 Container matching original message structure
                    const containerComponents = [];

                    // Image (if original had one)
                    if (broadcastData.imageUrl) {
                        containerComponents.push({
                            type: 12, // MediaGallery
                            items: [{ media: { url: broadcastData.imageUrl } }]
                        });
                    }

                    // Title (if original had one)
                    if (broadcastData.title) {
                        containerComponents.push({ type: 10, content: `**${broadcastData.title}**` });
                    }

                    // Content
                    containerComponents.push({ type: 10, content: broadcastData.content });

                    // Flag buttons at bottom
                    for (const btn of flagButtons) {
                        containerComponents.push(btn);
                    }

                    // "Click a flag" text inside the Container (V2 doesn't allow content field)
                    containerComponents.unshift({ type: 10, content: `🌐 **Click a flag to translate** (${flagLangs.length} languages)` });

                    await interaction.editReply({
                        flags: 32768,
                        components: [{
                            type: 17,
                            components: containerComponents
                        }]
                    });
                } catch (err) {
                    logger.warn('translate_broadcast handler error', { error: err?.message || err });
                    try {
                        await interaction.editReply({ content: '❌ Error loading translation options.' });
                    } catch {}
                }
                return;
            }

            // Handle Broadcast Language flag click — translate and edit the SAME message
            if (customId.startsWith('tfl:')) {
                try {
                    const parts = customId.split(':');
                    const guildId = parts[1];
                    const messageId = parts[2];
                    const targetLang = parts.slice(3).join(':');

                    // Get original content from the ephemeral V2 Container
                    let broadcastData = null;
                    try {
                        const ephemeralMsg = await interaction.message.fetch();
                        const container = ephemeralMsg.components?.[0];
                        if (container?.components?.length) {
                            let imageUrl = null;
                            let title = null;
                            let content = null;

                            for (const comp of container.components) {
                                if (comp.type === 12 && comp.items?.[0]?.media?.url) {
                                    // MediaGallery = image
                                    imageUrl = comp.items[0].media.url;
                                } else if (comp.type === 10) {
                                    // TextDisplay = title or content
                                    const text = comp.content;
                                    if (text.startsWith('**') && text.endsWith('**')) {
                                        title = text.replace(/\*\*/g, '');
                                    } else if (!content) {
                                        content = text;
                                    }
                                }
                            }

                            if (content) {
                                broadcastData = { title, content, imageUrl, guildId };
                            }
                        }
                        // Fallback: try embed (for older messages)
                        if (!broadcastData?.content) {
                            const embed = ephemeralMsg.embeds?.[0];
                            if (embed?.description) {
                                broadcastData = {
                                    title: embed.title || null,
                                    content: embed.description,
                                    imageUrl: embed.image?.url || null,
                                    guildId
                                };
                            }
                        }
                    } catch {}

                    // Fallback: try the Map
                    if (!broadcastData?.content) {
                        broadcastData = global.broadcastMessages?.get(messageId);
                    }

                    // Fallback: try fetching the original broadcast message from channel
                    if (!broadcastData?.content) {
                        try {
                            const originalMsg = await interaction.channel.messages.fetch(messageId);
                            const embed = originalMsg.embeds?.[0];
                            broadcastData = {
                                title: embed?.title || null,
                                content: embed?.description || originalMsg.content || null,
                                guildId: guildId
                            };
                        } catch {}
                    }

                    if (!broadcastData?.content) {
                        await interaction.update({ content: '❌ Could not read the original message content.' });
                        return;
                    }

                    const flag = getLanguageFlag(targetLang);
                    const langName = getLanguageDisplayName(targetLang);

                    // Translate using Mistral Small 2506
                    const translatedContent = await translateText(
                        broadcastData.content,
                        targetLang,
                        'english',
                        false,
                        undefined,
                        'mistral-small-2506'
                    );

                    // Re-build flag buttons so user can translate to another language
                    const Server = require('./models/Server');
                    const serverDoc = await Server.findOne({ serverId: guildId }).lean();
                    let languages = [];
                    if (serverDoc) {
                        if (serverDoc.serverWideLanguages?.length) languages.push(...serverDoc.serverWideLanguages);
                        if (serverDoc.setups?.length) {
                            for (const setup of serverDoc.setups) {
                                if (setup.languages?.length) languages.push(...setup.languages);
                            }
                        }
                        languages = [...new Set(languages.map(l => l.toLowerCase().trim()))];
                    }
                    const translateLangs = languages.filter(l => l !== 'auto' && l !== 'english');
                    const flagLangs = translateLangs.slice(0, 15);
                    const flagButtons = [];

                    for (let i = 0; i < flagLangs.length; i += 5) {
                        const row = { type: 1, components: [] };
                        for (const lang of flagLangs.slice(i, i + 5)) {
                            const f = getLanguageFlag(lang);
                            row.components.push({
                                type: 2,
                                custom_id: `tfl:${guildId}:${messageId}:${lang}`,
                                label: f,
                                style: 2
                            });
                        }
                        flagButtons.push(row);
                    }

                    // Build V2 Container with translated content (mirror original structure)
                    const containerComponents = [];

                    // Image (if original had one)
                    if (broadcastData.imageUrl) {
                        containerComponents.push({
                            type: 12, // MediaGallery
                            items: [{ media: { url: broadcastData.imageUrl } }]
                        });
                    }

                    // Translated title (if original had one)
                    if (broadcastData.title) {
                        const translatedTitle = await translateText(
                            broadcastData.title,
                            targetLang,
                            'english',
                            false,
                            undefined,
                            'mistral-small-2506'
                        );
                        containerComponents.push({ type: 10, content: `**${translatedTitle}**` });
                    }

                    // Translated content
                    containerComponents.push({ type: 10, content: translatedContent });

                    // Flag buttons at bottom
                    for (const btn of flagButtons) {
                        containerComponents.push(btn);
                    }

                    // "Click another flag" text inside the Container
                    containerComponents.unshift({ type: 10, content: `🌐 **Click another flag to translate**` });

                    // Update the SAME message in-place
                    await interaction.update({
                        flags: 32768,
                        components: [{
                            type: 17,
                            components: containerComponents
                        }]
                    });
                } catch (err) {
                    logger.warn('translate_broadcast_lang handler error', { error: err?.message || err });
                    try {
                        await interaction.update({ content: '❌ Translation failed. Please try again.' });
                    } catch {}
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
    } else if (interaction.isStringSelectMenu()) {
        try {
            const customId = interaction.customId || '';
            
            // No string select menu handlers currently active
        } catch (error) {
            console.error('String select menu error:', error);
            try {
                await interaction.reply({
                    content: '❌ Failed to process selection. Please try again.',
                    ephemeral: true
                });
            } catch {}
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'pbSetLangModal') {
            try {
                const input = interaction.fields.getTextInputValue('pbLanguages') || '';
                const languages = input
                    .split(',')
                    .map(s => s.trim().toLowerCase())
                    .filter(Boolean);

                if (languages.length === 0) {
                    await interaction.reply({ content: '⚠️ Please provide at least one language.', flags: MessageFlags.Ephemeral });
                    return;
                }

                await databaseService.togglePersonalTranslation(interaction.user.id, true, languages);
                await interaction.reply({ content: `✅ Personal Buddy languages set to: ${languages.join(', ')}`, flags: MessageFlags.Ephemeral });
            } catch (e) {
                try { await interaction.reply({ content: '❌ Failed to save languages. Please try again.', flags: MessageFlags.Ephemeral }); } catch {}
            }
        } else if (interaction.customId === 'autosetup_langs') {
            try {
                const key = `${interaction.guildId}:${interaction.user.id}`;
                const state = global.autoSetupState.get(key) || {};
                const channelIds = state.channelIds || [];
                if (!channelIds.length) {
                    await interaction.reply({ content: '⚠️ No channels selected. Please run `/autosetup` again.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const raw = interaction.fields.getTextInputValue('autosetup_langs_input') || '';
                const languages = raw.split(',').map(s => s.trim()).filter(Boolean);
                if (languages.length === 0) {
                    await interaction.reply({ content: '⚠️ Please provide at least one language.', flags: MessageFlags.Ephemeral });
                    return;
                }

                // Build setup arrays: for each channel, AUTO_DETECT + each language
                const setupChannels = [];
                const setupLanguages = [];
                for (const chId of channelIds) {
                    setupChannels.push(chId);
                    setupLanguages.push(AUTO_DETECT_LANGUAGE);
                    for (const lang of languages) {
                        setupChannels.push(chId);
                        setupLanguages.push(lang);
                    }
                }

                const serverId = interaction.guildId;
                const serverName = interaction.guild?.name || 'Unknown';
                const setupName = `AutoSetup-${Date.now().toString().slice(-5)}`;

                await databaseService.createServerSetup(
                    serverId,
                    serverName,
                    setupName,
                    setupChannels,
                    setupLanguages
                );

                // Confirmation embed similar to quick setup
                const channelList = channelIds.map((id, i) => {
                    const emoji = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'][i] || '🔹';
                    return `${emoji} <#${id}>`;
                }).join('\n');

                const languageList = languages.map((lang, i) => {
                    const emoji = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'][i] || '🔹';
                    return `${emoji} **${lang}**`;
                }).join('\n');

                const embed = new EmbedBuilder()
                    .setColor(0x3498db)
                    .setTitle('🚀 Auto Setup Complete!')
                    .setDescription(`Setup **"${setupName}"** is now active with in-channel translation to multiple languages.`)
                    .addFields(
                        { name: '📡 Active Channels', value: channelList || 'No channels', inline: true },
                        { name: '🌍 Languages', value: languageList || 'No languages', inline: true },
                        { name: '💡 Tips', value: `Use \`/listsetups\` to view and \`/deletesetup name:${setupName}\` to remove.` }
                    )
                    .setTimestamp();

                global.autoSetupState.delete(key);
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            } catch (e) {
                try { await interaction.reply({ content: '❌ Failed to complete auto setup. Please try again.', flags: MessageFlags.Ephemeral }); } catch {}
            }
        } else if (interaction.customId.startsWith('commentModal_')) {
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
                const BASE_SERVER_COUNT = 19000;
                const BASE_VOTE_COUNT = 10000;
                const DAILY_GROWTH = 300;
                const START_DATE = new Date('2025-01-01').getTime();
                const getDaysRunning = () => Math.floor((Date.now() - START_DATE) / 86400000);
                const getDisplayedServerCount = () => BASE_SERVER_COUNT + client.guilds.cache.size;
                const getProjectedPoints = (daysRunning) => BASE_VOTE_COUNT + (daysRunning * DAILY_GROWTH);

                const poster = AutoPoster(process.env.TOPGG_TOKEN, client);

                poster.on('posted', async () => {
                    const daysRunning = getDaysRunning();
                    const displayedServers = getDisplayedServerCount();
                    const projectedPoints = getProjectedPoints(daysRunning);
                    const stats = await fetchTopGgBotStats(process.env.CLIENT_ID);

                    const points = stats?.points ?? projectedPoints;
                    const monthlyPoints = stats?.monthlyPoints ?? 'n/a';

                    logger.success(
                        `Top.gg Rank Booster Active | Showing ${displayedServers} servers | Points: ${points} | Monthly points: ${monthlyPoints}`
                    );
                });

                poster.getStats = async () => {
                    const daysRunning = getDaysRunning();
                    const projectedPoints = getProjectedPoints(daysRunning);

                    return {
                        serverCount: getDisplayedServerCount(),
                        voteCount: projectedPoints,
                        premiumCount: 1000,
                        donateCount: 500,
                        shardCount: client.shard?.count ?? 1
                    };
                };

                poster.on('error', (error) => {
                    logger.warn('Top.gg API Error', error);
                });
            } catch (error) {
                logger.warn('Top.gg Integration Failed', error);
            }
        }

        // Start admin server (new modular version)
        require('./admin/server');
        
        // Start dashboard API server
        try {
            const express = require('express');
            const cors = require('cors');
            const dashboardApi = require('./services/dashboardApi');
            
            // Inject bot client into router for guild access
            dashboardApi.botClient = client;
            
            const app = express();
            app.use(cors({
                origin: process.env.DASHBOARD_URL || 'http://localhost:5173',
                credentials: true,
                allowedHeaders: ['Content-Type', 'X-Session-ID', 'Authorization']
            }));
            app.use(express.json());
            app.use('/api', dashboardApi);
            
            const PORT = process.env.BOT_API_PORT || 3001;
            app.listen(PORT, () => {
                logger.success(`Dashboard API listening on port ${PORT}`);
            });
        } catch (error) {
            logger.warn('Failed to start dashboard API', error);
        }
        
        logger.success('Bot started successfully!');
        logger.info('Modern admin panel available at /admin');
        // Start processing queued translations
        translationQueueService.startQueueProcessor((content, targetLanguage) => {
            // Round-robin: each queued request gets the next API key in sequence
            const { keys, keyIndex, totalKeys } = translationQueueService.getNextApiKey();
            const apiKey = keys[0]; // Primary key for this request
            const keySuffix = apiKey ? apiKey.slice(-4) : 'undefined';

            logger.debug(`[Queue] Using Key ${keyIndex} of ${totalKeys} → ***${keySuffix} for ${targetLanguage}`);
            return translateTextToMultipleLanguages(
                content, 
                [targetLanguage],
                null, // auto-detect
                null, // tone settings
                apiKey
            );
        });
    } catch (error) {
        logger.error('Failed to start bot', error);
        process.exit(1);
    }
}

startBot();