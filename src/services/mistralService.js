const axios = require('axios');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Helper to POST to Mistral with automatic retries on 429 or network errors.
 * @param {object} payload - JSON body for chat/completions
 * @param {number} maxRetries - maximum retry attempts
 */
const postMistralWithRetry = async (payload, maxRetries = 5) => {
    let attempt = 0;
    while (true) {
        try {
            return await axios.post(mistralAPIUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (err) {
            const status = err.response?.status;
            // Retry only on 429 or network errors
            if (attempt >= maxRetries || (status && status !== 429)) {
                throw err;
            }
            const backoff = Math.min(60000, (2 ** attempt) * 1000 + Math.random() * 500);
            console.warn(`Mistral request failed (status ${status}). Retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(backoff);
            attempt++;
        }
    }
};
const { MISTRAL_API_KEY, AUTO_DETECT_LANGUAGE } = require('../utils/constants');

const mistralAPIUrl = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Normalizes elongated text by reducing excessive character repetition
 * @param {string} text - The text to normalize
 * @returns {string} - The normalized text
 */
const normalizeElongatedText = (text) => {
    // Reduce excessive character repetition (more than 3 consecutive characters)
    return text.replace(/([a-zA-Z0-9])\1{3,}/g, (match, char) => {
        // Keep maximum 3 repetitions for emphasis
        return char.repeat(3);
    });
};

const detectLanguage = async (text) => {
    try {
        // Normalize the text before detection
        const normalizedText = normalizeElongatedText(text);
        
        const response = await postMistralWithRetry({
            model: 'mistral-medium-latest',
            messages: [
                {
                    role: 'system',
                    content: 'You are a language detector. Analyze the text and respond with ONLY the ISO language code (en, fr, es, de, it, ko, ur, etc). Consider informal writing, slang, and elongated words. No explanation or additional text.'
                },
                {
                    role: 'user',
                    content: `Detect the language of this text and respond only with the language code: "${normalizedText}"`
                }
            ],
            temperature: 0.1,
            max_tokens: 10
        });

        let langCode = response.data.choices[0].message.content.trim().toLowerCase();
        
        // Clean up the language code (remove quotes, punctuation, etc.)
        langCode = langCode.replace(/[^\w]/g, '');
        
        return langCode;
    } catch (error) {
        console.error('Error detecting language:', error);
        return 'en'; // Default to English if detection fails
    }
};

const translateText = async (text, targetLanguage, sourceLanguage = null, useToneUnderstanding = false) => {
    try {
        // If target language is "auto", we don't need to translate
        if (targetLanguage === AUTO_DETECT_LANGUAGE) {
            return text;
        }

        // Normalize elongated text before translation
        const normalizedText = normalizeElongatedText(text);

        // If no source language is provided and target isn't auto, detect the language
        if (!sourceLanguage && targetLanguage !== AUTO_DETECT_LANGUAGE) {
            sourceLanguage = await detectLanguage(normalizedText);
        }

        // If the detected source language is the same as the target, no translation needed
        if (sourceLanguage && sourceLanguage === targetLanguage) {
            return text;
        }

        // --- Handle very long texts by translating in smaller chunks to avoid context/token limits ---
        const MAX_CHUNK_LENGTH = 2500; // characters, chosen to stay comfortably within provider limits
        if (normalizedText.length > MAX_CHUNK_LENGTH) {
            // Split text on natural boundaries (newline or space) close to the limit
            const chunks = [];
            let remaining = normalizedText;
            while (remaining.length > MAX_CHUNK_LENGTH) {
                let splitIdx = remaining.lastIndexOf('\n', MAX_CHUNK_LENGTH);
                if (splitIdx === -1) {
                    splitIdx = remaining.lastIndexOf(' ', MAX_CHUNK_LENGTH);
                }
                if (splitIdx === -1 || splitIdx < MAX_CHUNK_LENGTH * 0.5) {
                    splitIdx = MAX_CHUNK_LENGTH; // fallback to hard split
                }
                chunks.push(remaining.slice(0, splitIdx + 1));
                remaining = remaining.slice(splitIdx + 1);
            }
            if (remaining.length) {
                chunks.push(remaining);
            }

            // Translate each chunk individually and concatenate the results
            const translatedChunks = [];
            for (const chunk of chunks) {
                const translatedChunk = await translateText(chunk, targetLanguage, sourceLanguage, useToneUnderstanding);
                translatedChunks.push(translatedChunk);
            }
            return translatedChunks.join('');
        }

        // Create appropriate system prompt based on tone understanding setting
        let systemContent = `You are a professional and native translator. Translate text naturally while preserving the original meaning, style, and special characters.

IMPORTANT TRANSLATION RULES:
- For elongated words (like "heyyyyy"), translate to equivalent casual form in target language
- If target language doesn't use elongation, keep meaning but remove repetitions
- Preserve every emoji exactly as written (e.g. keep 😊 as 😊, ❤️ as ❤️)
- Never translate emoji meanings (e.g. don't convert 😊 to 'smiling face')
- Maintain original emoji positions in the text
- Preserve all original line breaks (including multiple blank lines) and spacing exactly as in the input

OTHER RULES:
- Preserve punctuation and special characters
- Keep translations concise and natural
- Only provide the direct translation without explanations`;

        if (useToneUnderstanding) {
            systemContent = `You are an advanced translator with tone understanding. Preserve the original tone, emotion, formality, humor, cultural nuances, and special characters when translating.

IMPORTANT TRANSLATION RULES:
- For elongated words (like "heyyyyy"), translate to equivalent casual form in target language
- If target language doesn't use elongation, keep meaning but remove repetitions
- Preserve every emoji exactly as written (e.g. keep 😊 as 😊, ❤️ as ❤️)
- Never translate emoji meanings (e.g. don't convert 😊 to 'smiling face')
- Maintain original emoji positions
- Preserve all original line breaks (including multiple blank lines) and spacing exactly as in the input

OTHER RULES:
- Preserve punctuation and special characters
- Keep translations natural while maintaining tone
- Consider cultural context for text (but never for emojis)
- Only provide the direct translation without explanations`;
        }

        // Get language names for better context
        const getLanguageName = (code) => {
            const languages = {
                'en': 'English',
                'es': 'Spanish', 
                'fr': 'French',
                'de': 'German',
                'it': 'Italian',
                'pt': 'Portuguese',
                'pt-BR': 'Portuguese (Brazil)',
                'ko': 'Korean',
                'ja': 'Japanese',
                'zh': 'Chinese (Simplified)',
                'zh-TW': 'Chinese (Traditional)',
                'taiwanese': 'Chinese (Traditional)',
                'tawaiese': 'Chinese (Traditional)',
                'tawainese hoekin': 'Chinese (Traditional)',
                'hi': 'Hindi',
                'bn': 'Bengali',
                'pa': 'Punjabi',
                'ta': 'Tamil',
                'te': 'Telugu',
                'mr': 'Marathi',
                'ur': 'Urdu',
                'ar': 'Arabic',
                'fa': 'Persian',
                'tr': 'Turkish',
                'ru': 'Russian',
                'uk': 'Ukrainian',
                'pl': 'Polish',
                'nl': 'Dutch',
                'sv': 'Swedish',
                'fi': 'Finnish',
                'da': 'Danish',
                'no': 'Norwegian',
                'th': 'Thai',
                'vi': 'Vietnamese',
                'id': 'Indonesian',
                'ms': 'Malay',
                'fil': 'Filipino',
                'he': 'Hebrew',
                'el': 'Greek',
                'hu': 'Hungarian',
                'cs': 'Czech',
                'ro': 'Romanian',
                'bg': 'Bulgarian',
                'sr': 'Serbian',
                'hr': 'Croatian',
                'sk': 'Slovak',
                'sl': 'Slovenian',
                'lt': 'Lithuanian',
                'lv': 'Latvian',
                'et': 'Estonian',
                'sw': 'Swahili',
                'af': 'Afrikaans',
                'zu': 'Zulu',
                'xh': 'Xhosa',
                'ne': 'Nepali',
                'si': 'Sinhala',
                'my': 'Burmese',
                'km': 'Khmer',
                'lo': 'Lao',
                'am': 'Amharic',
                'ti': 'Tigrinya',
                'or': 'Odia',
                'as': 'Assamese',
                'gu': 'Gujarati',
                'kn': 'Kannada',
                'ml': 'Malayalam',
                'sd': 'Sindhi',
                'ps': 'Pashto',
                'ku': 'Kurdish',
                'tk': 'Turkmen',
                'uz': 'Uzbek',
                'kk': 'Kazakh',
                'ky': 'Kyrgyz',
                'tg': 'Tajik',
                'mn': 'Mongolian',
                'bo': 'Tibetan'
            };
       
            
            return languages[code] || code;
        };

        const targetLangName = getLanguageName(targetLanguage);

        const response = await postMistralWithRetry({
            model: 'mistral-small-latest',
            messages: [
                {
                    role: 'system',
                    content: systemContent
                },
                {
                    role: 'user',
                    content: `Translate this text to ${targetLangName}. Preserve original line breaks and spacing. Keep it natural and concise: "${normalizedText}"`
                }
            ],
            temperature: 0.2,
            // Dynamically set max_tokens but cap it to avoid hitting hard limits
            max_tokens: Math.min(4096, Math.max(400, Math.ceil(normalizedText.length * 1.2))) // Allow sufficient tokens while preventing truncation
        });

        let translation = response.data.choices[0].message.content.trim();
        
        // Remove quotes if they exist around the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) || 
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }
        
        // Keep full translation lines 
        return translation;
    } catch (error) {
        console.error('Error translating text:', error);
        throw new Error('Translation failed');
    }
};

module.exports = {
    translateText,
    detectLanguage
};