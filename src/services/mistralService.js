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
    return text.replace(/(.)\1{3,}/g, (match, char) => {
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

        // Create appropriate system prompt based on tone understanding setting
        let systemContent = `You are a professional translator. Translate text naturally while preserving the original meaning and style. 

IMPORTANT RULES:
- Keep translations concise and natural
- If the original has elongated words (like "heyyyy"), translate to equivalent casual form in target language
- Do NOT repeat characters excessively in the translation
- Preserve informal tone but keep it readable
- Maximum translation length should be reasonable relative to original
- Only provide the direct translation without explanations`;
        
        if (useToneUnderstanding) {
            systemContent = `You are an advanced translator with tone understanding. Preserve the original tone, emotion, formality, humor, and cultural nuances when translating.

IMPORTANT RULES:
- Keep translations concise and natural
- If the original has elongated words (like "heyyyy"), translate to equivalent casual form in target language
- Do NOT repeat characters excessively in the translation - use normal amounts of repetition for emphasis
- Preserve the casual/informal tone appropriately for the target language
- Consider cultural context and slang equivalents
- Maximum translation length should be proportional to original text
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
                'ko': 'Korean',
                'ur': 'Urdu',
                'ar': 'Arabic',
                'ja': 'Japanese',
                'zh': 'Chinese',
                'hi': 'Hindi',
                'ru': 'Russian'
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
                    content: `Translate this text to ${targetLangName}. Keep it natural and concise: "${normalizedText}"`
                }
            ],
            temperature: 0.2,
            max_tokens: Math.max(200, normalizedText.length * 4) // Allow more tokens
        });

        let translation = response.data.choices[0].message.content.trim();
        
        // Remove quotes if they exist around the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) || 
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }
        
                // Keep only the first meaningful line to avoid extra notes
        translation = translation.split('\n').find(l => l.trim().length > 0)?.trim() || translation;
        // Remove leading bracketed explanations like [text]:
        translation = translation.replace(/^\[[^\]]+\]:?\s*/i, '').trim();
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