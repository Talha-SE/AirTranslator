const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ko', 'ur', 'ar', 'ja', 'zh', 'hi', 'ru', 'auto'];
const MIN_CHANNELS_REQUIRED = 2;
const MIN_LANGUAGES_REQUIRED = 1;
const AUTO_DETECT_LANGUAGE = 'auto';
const TONE_UNDERSTANDING_ENABLED = 'tone_enabled';
const MAX_TRANSLATION_LENGTH_RATIO = 7; // Maximum ratio of translation length to original length
const FALLBACK_TRANSLATION_MODEL = 'mistral-small-2501';

module.exports = {
    MISTRAL_API_KEY,
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    MIN_CHANNELS_REQUIRED,
    MIN_LANGUAGES_REQUIRED,
    AUTO_DETECT_LANGUAGE,
    TONE_UNDERSTANDING_ENABLED,
    MAX_TRANSLATION_LENGTH_RATIO,
    FALLBACK_TRANSLATION_MODEL
};