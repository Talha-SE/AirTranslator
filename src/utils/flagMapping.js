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
    '🇹🇼': 'zh-TW',        // Taiwan (Chinese Traditional)
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
    const displayNames = {
        'english': 'English',
        'spanish': 'Spanish',
        'french': 'French',
        'german': 'German',
        'italian': 'Italian',
        'portuguese': 'Portuguese',
        'russian': 'Russian',
        'chinese': 'Chinese',
        'zh-TW': 'Chinese (Traditional)',
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
    
    return displayNames[languageCode.toLowerCase()] || languageCode.charAt(0).toUpperCase() + languageCode.slice(1);
}

module.exports = {
    getFlagLanguage,
    getSupportedFlags,
    getPopularFlags,
    getLanguageDisplayName,
    flagToLanguage
};
