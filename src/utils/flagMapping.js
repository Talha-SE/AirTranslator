/**
 * Mapping of flag emojis to language names
 * This allows users to react with flags to translate messages
 */

const flagToLanguage = {
    // Major languages
    '🇺🇸': 'english',      // United States
    '🇬🇧': 'english',      // United Kingdom
    '🇪🇸': 'spanish',      // Spain
    '🇲🇽': 'spanish',      // Mexico
    '🇫🇷': 'french',       // France
    '🇩🇪': 'german',       // Germany
    '🇮🇹': 'italian',      // Italy
    '🇵🇹': 'portuguese',   // Portugal
    '🇧🇷': 'portuguese',   // Brazil
    '🇷🇺': 'russian',      // Russia
    '🇨🇳': 'chinese',      // China
    '🇹🇼': 'chinese (traditional)', // Taiwan (Chinese Traditional)
    '🇯🇵': 'japanese',     // Japan
    '🇰🇷': 'korean',       // South Korea
    '🇮🇳': 'hindi',        // India
    '🇸🇦': 'arabic',       // Saudi Arabia
    '🇦🇪': 'arabic',       // UAE
    '🇹🇷': 'turkish',      // Turkey
    '🇳🇱': 'dutch',        // Netherlands
    '🇸🇪': 'swedish',      // Sweden
    '🇳🇴': 'norwegian',    // Norway
    '🇩🇰': 'danish',       // Denmark
    '🇫🇮': 'finnish',      // Finland
    '🇵🇱': 'polish',       // Poland
    '🇬🇷': 'greek',        // Greece
    '🇹🇭': 'thai',         // Thailand
    '🇻🇳': 'vietnamese',   // Vietnam
    '🇮🇩': 'indonesian',   // Indonesia
    '🇲🇾': 'malay',        // Malaysia
    '🇵🇭': 'filipino',     // Philippines
    
    // European languages
    '🇨🇿': 'czech',        // Czech Republic
    '🇸🇰': 'slovak',       // Slovakia
    '🇭🇺': 'hungarian',    // Hungary
    '🇷🇴': 'romanian',     // Romania
    '🇧🇬': 'bulgarian',    // Bulgaria
    '🇭🇷': 'croatian',     // Croatia
    '🇸🇮': 'slovenian',    // Slovenia
    '🇷🇸': 'serbian',      // Serbia
    '🇺🇦': 'ukrainian',    // Ukraine
    '🇱🇹': 'lithuanian',   // Lithuania
    '🇱🇻': 'latvian',      // Latvia
    '🇪🇪': 'estonian',     // Estonia
    '🇮🇸': 'icelandic',    // Iceland
    '🇮🇪': 'irish',        // Ireland
    
    // African languages
    '🇿🇦': 'afrikaans',    // South Africa
    '🇰🇪': 'swahili',      // Kenya
    '🇪🇹': 'amharic',      // Ethiopia
    '🇳🇬': 'yoruba',       // Nigeria
    
    // Asian languages
    '🇧🇩': 'bengali',      // Bangladesh
    '🇱🇰': 'sinhala',      // Sri Lanka
    '🇲🇲': 'burmese',      // Myanmar
    '🇰🇭': 'khmer',        // Cambodia
    '🇱🇦': 'lao',          // Laos
    '🇲🇳': 'mongolian',    // Mongolia
    '🇰🇿': 'kazakh',       // Kazakhstan
    '🇺🇿': 'uzbek',        // Uzbekistan
    '🇦🇿': 'azerbaijani',  // Azerbaijan
    '🇦🇲': 'armenian',     // Armenia
    '🇬🇪': 'georgian',     // Georgia
    '🇮🇱': 'hebrew',       // Israel
    '🇮🇷': 'persian',      // Iran
    '🇦🇫': 'pashto',       // Afghanistan
    '🇵🇰': 'urdu',         // Pakistan
    
    // Americas
    '🇦🇷': 'spanish',      // Argentina
    '🇨🇴': 'spanish',      // Colombia
    '🇵🇪': 'spanish',      // Peru
    '🇨🇱': 'spanish',      // Chile
    '🇻🇪': 'spanish',      // Venezuela
    '🇪🇨': 'spanish',      // Ecuador
    '🇺🇾': 'spanish',      // Uruguay
    '🇵🇾': 'spanish',      // Paraguay
    '🇧🇴': 'spanish',      // Bolivia
    '🇬🇹': 'spanish',      // Guatemala
    '🇨🇺': 'spanish',      // Cuba
    '🇩🇴': 'spanish',      // Dominican Republic
};

const languageAliases = {
    // Chinese variants
    'zh': 'chinese',
    'zh-cn': 'chinese',
    'zh_cn': 'chinese',
    'zh-hans': 'chinese',
    'zh_hans': 'chinese',
    'chinese (simplified)': 'chinese',
    'simplified chinese': 'chinese',
    'chinese simplified': 'chinese',
    'zh-tw': 'chinese (traditional)',
    'zh_tw': 'chinese (traditional)',
    'zh-hant': 'chinese (traditional)',
    'zh_hant': 'chinese (traditional)',
    'chinese traditional': 'chinese (traditional)',
    'traditional chinese': 'chinese (traditional)',

    // Common code aliases
    'en': 'english',
    'es': 'spanish',
    'fr': 'french',
    'de': 'german',
    'it': 'italian',
    'pt': 'portuguese',
    'ru': 'russian',
    'ja': 'japanese',
    'ko': 'korean',
    'hi': 'hindi',
    'ar': 'arabic',
    'tr': 'turkish',
    'nl': 'dutch',
    'sv': 'swedish',
    'no': 'norwegian',
    'da': 'danish',
    'fi': 'finnish',
    'pl': 'polish',
    'cs': 'czech',
    'el': 'greek',
    'uk': 'ukrainian',
    'ro': 'romanian',
    'hu': 'hungarian',
    'bg': 'bulgarian',
    'hr': 'croatian',
    'sr': 'serbian',
    'sk': 'slovak',
    'sl': 'slovenian',
    'et': 'estonian',
    'lv': 'latvian',
    'lt': 'lithuanian',
    'ur': 'urdu',
    'fa': 'persian',
    'he': 'hebrew',
    'ms': 'malay',
    'id': 'indonesian',
    'vi': 'vietnamese',
    'th': 'thai',
    'bn': 'bengali',
    'sw': 'swahili'
};

function normalizeLanguageCode(languageCode) {
    const normalized = String(languageCode || '').trim().toLowerCase();
    if (!normalized) return '';
    return languageAliases[normalized] || normalized;
}

const languageToFlag = {
    // Major languages
    'english': '🇬🇧',
    'spanish': '🇪🇸',
    'french': '🇫🇷',
    'german': '🇩🇪',
    'italian': '🇮🇹',
    'portuguese': '🇵🇹',
    'russian': '🇷🇺',
    'chinese': '🇨🇳',
    'chinese (traditional)': '🇹🇼',
    'japanese': '🇯🇵',
    'korean': '🇰🇷',
    'hindi': '🇮🇳',
    'arabic': '🇸🇦',
    'turkish': '🇹🇷',
    'dutch': '🇳🇱',
    'swedish': '🇸🇪',
    'norwegian': '🇳🇴',
    'danish': '🇩🇰',
    'finnish': '🇫🇮',
    'polish': '🇵🇱',
    'greek': '🇬🇷',
    'thai': '🇹🇭',
    'vietnamese': '🇻🇳',
    'indonesian': '🇮🇩',
    'malay': '🇲🇾',
    'filipino': '🇵🇭',

    // Extended set
    'czech': '🇨🇿',
    'slovak': '🇸🇰',
    'hungarian': '🇭🇺',
    'romanian': '🇷🇴',
    'bulgarian': '🇧🇬',
    'croatian': '🇭🇷',
    'slovenian': '🇸🇮',
    'serbian': '🇷🇸',
    'ukrainian': '🇺🇦',
    'lithuanian': '🇱🇹',
    'latvian': '🇱🇻',
    'estonian': '🇪🇪',
    'icelandic': '🇮🇸',
    'irish': '🇮🇪',
    'afrikaans': '🇿🇦',
    'swahili': '🇰🇪',
    'amharic': '🇪🇹',
    'yoruba': '🇳🇬',
    'bengali': '🇧🇩',
    'sinhala': '🇱🇰',
    'burmese': '🇲🇲',
    'khmer': '🇰🇭',
    'lao': '🇱🇦',
    'mongolian': '🇲🇳',
    'kazakh': '🇰🇿',
    'uzbek': '🇺🇿',
    'azerbaijani': '🇦🇿',
    'armenian': '🇦🇲',
    'georgian': '🇬🇪',
    'hebrew': '🇮🇱',
    'persian': '🇮🇷',
    'pashto': '🇦🇫',
    'urdu': '🇵🇰',
    'tagalog': '🇵🇭'
};

/**
 * Get language name from flag emoji
 * @param {string} flagEmoji - The flag emoji
 * @returns {string|null} Language name or null if not found
 */
function getFlagLanguage(flagEmoji) {
    return flagToLanguage[flagEmoji] || null;
}

/**
 * Get all supported flag emojis
 * @returns {string[]} Array of flag emojis
 */
function getSupportedFlags() {
    return Object.keys(flagToLanguage);
}

/**
 * Get popular flags for quick access
 * @returns {string[]} Array of popular flag emojis
 */
function getPopularFlags() {
    return ['🇺🇸', '🇪🇸', '🇫🇷', '🇩🇪', '🇮🇹', '🇵🇹', '🇷🇺', '🇨🇳', '🇹🇼', '🇯🇵', '🇰🇷', '🇮🇳', '🇸🇦', '🇹🇷', '🇳🇱'];
}

/**
 * Get display name for a language code
 * @param {string} languageCode - The language code
 * @returns {string} The display name of the language
 */
function getLanguageDisplayName(languageCode) {
    const canonicalCode = normalizeLanguageCode(languageCode);
    const displayNames = {
        'english': 'English',
        'spanish': 'Spanish',
        'french': 'French',
        'german': 'German',
        'italian': 'Italian',
        'portuguese': 'Portuguese',
        'russian': 'Russian',
        'chinese': 'Chinese',
        'chinese (traditional)': 'Chinese (Traditional)',
        'japanese': 'Japanese',
        'korean': 'Korean',
        'hindi': 'Hindi',
        'arabic': 'Arabic',
        'turkish': 'Turkish',
        'dutch': 'Dutch',
        'swedish': 'Swedish',
        'norwegian': 'Norwegian',
        'danish': 'Danish',
        'finnish': 'Finnish',
        'polish': 'Polish',
        'czech': 'Czech',
        'hungarian': 'Hungarian',
        'romanian': 'Romanian',
        'bulgarian': 'Bulgarian',
        'croatian': 'Croatian',
        'serbian': 'Serbian',
        'slovenian': 'Slovenian',
        'slovak': 'Slovak',
        'estonian': 'Estonian',
        'latvian': 'Latvian',
        'lithuanian': 'Lithuanian',
        'greek': 'Greek',
        'ukrainian': 'Ukrainian',
        'vietnamese': 'Vietnamese',
        'thai': 'Thai',
        'indonesian': 'Indonesian',
        'malay': 'Malay',
        'hebrew': 'Hebrew',
        'persian': 'Persian',
        'unknown': 'Unknown'
    };
    
    return displayNames[canonicalCode] || canonicalCode.charAt(0).toUpperCase() + canonicalCode.slice(1);
}

function getLanguageFlag(languageCode) {
    const canonicalCode = normalizeLanguageCode(languageCode);
    return languageToFlag[canonicalCode] || '🌐';
}

module.exports = {
    normalizeLanguageCode,
    getLanguageFlag,
    getFlagLanguage,
    getSupportedFlags,
    getPopularFlags,
    getLanguageDisplayName,
    flagToLanguage
};
