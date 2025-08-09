const axios = require('axios');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Detects and marks proper names for transliteration (not translation)
 * @param {string} text - The original text
 * @returns {object} - Object containing processed text and name mappings
 */
const markNamesForTransliteration = (text) => {
    const nameMap = new Map();
    let processedText = text;

    // Patterns to detect names and proper nouns that should be transliterated, not translated
    const patterns = [
        // @mentions - preserve completely
        /@\w+/g,
        // #hashtags - preserve completely
        /#\w+/g,
        // URLs - preserve completely
        /https?:\/\/[^\s]+/g,
        // Discord user/channel mentions - preserve completely
        /<[@#&!]\d+>/g,
        // Email addresses - preserve completely
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
    ];

    // Items that should be preserved completely (not even transliterated)
    patterns.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        matches.forEach(match => {
            if (nameMap.has(match)) return;
            
            const placeholder = `__PRESERVE_${index}_${nameMap.size}__`;
            nameMap.set(placeholder, match);
            processedText = processedText.replace(new RegExp(escapeRegExp(match), 'g'), placeholder);
        });
    });

    return { processedText, nameMap };
};

/**
 * Restores preserved items in translated text
 * @param {string} translatedText - The translated text with placeholders
 * @param {Map} nameMap - Map of placeholders to original items
 * @returns {string} - Text with preserved items restored
 */
const restorePreservedItems = (translatedText, nameMap) => {
    let restoredText = translatedText;
    
    nameMap.forEach((originalItem, placeholder) => {
        restoredText = restoredText.replace(new RegExp(escapeRegExp(placeholder), 'g'), originalItem);
    });
    
    return restoredText;
};

/**
 * Escapes special regex characters in a string
 * @param {string} string - String to escape
 * @returns {string} - Escaped string
 */
const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Removes unwanted explanatory notes from translations
 * @param {string} translation - The translated text
 * @returns {string} - Clean translation without notes
 */
const removeUnwantedNotes = (translation) => {
    // Remove common note patterns
    const notePatterns = [
        /\(Note:.*?\)/gi,
        /\(Translation:.*?\)/gi,
        /\(The original.*?\)/gi,
        /\(This.*?\)/gi,
        /\(Please note.*?\)/gi,
        /\(Literal.*?\)/gi,
        /\(Alternative.*?\)/gi,
        /\(More natural.*?\)/gi,
        /\(Context:.*?\)/gi,
        /\(Explanation:.*?\)/gi,
        // Remove standalone explanatory sentences that start common ways
        /\n\s*Note:.*?(?=\n|$)/gi,
        /\n\s*Translation:.*?(?=\n|$)/gi,
        /\n\s*The original.*?(?=\n|$)/gi,
        /\n\s*This translation.*?(?=\n|$)/gi,
    ];
    
    let cleanTranslation = translation;
    notePatterns.forEach(pattern => {
        cleanTranslation = cleanTranslation.replace(pattern, '');
    });
    
    // Clean up extra whitespace left behind
    cleanTranslation = cleanTranslation.replace(/\n\s*\n/g, '\n').trim();
    
    return cleanTranslation;
};

/**
 * Helper to POST to Mistral with automatic retries on 429 or network errors.
 * @param {object} payload - JSON body for chat/completions
 * @param {number} maxRetries - maximum retry attempts
 * @param {string} [apiKey] - Optional custom API key
 */
const postMistralWithRetry = async (payload, maxRetries = 5, apiKey = MISTRAL_API_KEY) => {
    let attempt = 0;
    while (true) {
        try {
            return await axios.post(mistralAPIUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
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

const translateText = async (text, targetLanguage, sourceLanguage = null, useToneUnderstanding = false, apiKey = MISTRAL_API_KEY) => {
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
            
            // Only preserve technical items across all chunks
            const { processedText: allProcessedText, nameMap } = markNamesForTransliteration(normalizedText);
            
            // Re-split the processed text into chunks
            const processedChunks = [];
            let processedRemaining = allProcessedText;
            while (processedRemaining.length > MAX_CHUNK_LENGTH) {
                let splitIdx = processedRemaining.lastIndexOf('\n', MAX_CHUNK_LENGTH);
                if (splitIdx === -1) {
                    splitIdx = processedRemaining.lastIndexOf(' ', MAX_CHUNK_LENGTH);
                }
                if (splitIdx === -1 || splitIdx < MAX_CHUNK_LENGTH * 0.5) {
                    splitIdx = MAX_CHUNK_LENGTH;
                }
                processedChunks.push(processedRemaining.slice(0, splitIdx + 1));
                processedRemaining = processedRemaining.slice(splitIdx + 1);
            }
            if (processedRemaining.length) {
                processedChunks.push(processedRemaining);
            }
            
            // Translate each processed chunk
            for (const chunk of processedChunks) {
                // Recursive call but with shorter text (won't trigger chunking again)
                const translatedChunk = await translateText(chunk, targetLanguage, sourceLanguage, useToneUnderstanding, apiKey);
                translatedChunks.push(translatedChunk);
            }
            
            // Restore preserved items in the final result
            const finalTranslation = translatedChunks.join('');
            return restorePreservedItems(finalTranslation, nameMap);
        }

        // Create appropriate system prompt based on tone understanding setting
        let systemContent = `You are a professional translator. Translate text naturally while preserving meaning and style.

CRITICAL TRANSLATION RULES - FOLLOW EXACTLY:
- NEVER add any notes, explanations, disclaimers, comments, or parenthetical remarks
- NEVER write anything like "(Note: ...)", "(Translation: ...)", or "(The original...)"
- NEVER explain ambiguities, difficulties, or interpretation choices
- NEVER add context about the source language, translation process, or methodology
- NEVER justify translation choices or mention alternative interpretations
- For elongated words (like "heyyyyy"), translate to equivalent casual form in target language
- If target language doesn't use elongation, keep meaning but remove repetitions
- Preserve every emoji exactly as written (😊 stays 😊, ❤️ stays ❤️)
- Never translate emoji meanings
- Maintain original emoji positions
- Preserve all line breaks and spacing exactly
- Preserve punctuation and special characters

KOREAN TRANSLATION ACCURACY RULES:
- 나 = I/me (NOT "you")
- 저 = I/me (formal, NOT "you") 
- 너 = you (informal)
- 당신 = you (formal)
- 우리 = we/us (NOT "I")
- Pay special attention to Korean pronouns - they are often mistranslated
- Korean sentence structure: Subject-Object-Verb order, translate meaning correctly
- Consider Korean honorific levels (반말/존댓말) in context

TRANSLITERATION RULES:
- For proper names (people, places, brands), transliterate them into the target language's writing system
- Example: "John" becomes "جون" in Arabic, "ジョン" in Japanese, "约翰" in Chinese
- Example: "McDonald's" becomes "ماكدونالدز" in Arabic, "マクドナルド" in Japanese
- Do NOT translate the meaning of names, only convert the sound/pronunciation
- Keep the same pronunciation but write it in target language script

If input appears meaningless:
- Convert letter-by-letter to target language sounds
- Never comment on the input
- Never add disclaimers

FINAL RULE: Return ONLY the translated text. Nothing else. No explanations whatsoever.`;

        if (useToneUnderstanding) {
            systemContent = `You are an advanced translator with tone understanding. Preserve tone, emotion, formality, and cultural nuances.

CRITICAL TRANSLATION RULES - FOLLOW EXACTLY:
- NEVER add any notes, explanations, disclaimers, comments, or parenthetical remarks
- NEVER write anything like "(Note: ...)", "(Translation: ...)", or "(The original...)"
- NEVER explain ambiguities, difficulties, or interpretation choices
- NEVER add context about the source language, translation process, or methodology
- NEVER justify translation choices or mention alternative interpretations
- For elongated words (like "heyyyyy"), translate to equivalent casual form in target language
- If target language doesn't use elongation, keep meaning but remove repetitions
- Preserve every emoji exactly as written (😊 stays 😊, ❤️ stays ❤️)
- Never translate emoji meanings
- Maintain original emoji positions
- Preserve all line breaks and spacing exactly
- Preserve punctuation and special characters

KOREAN TRANSLATION ACCURACY RULES:
- 나 = I/me (NOT "you")
- 저 = I/me (formal, NOT "you") 
- 너 = you (informal)
- 당신 = you (formal)
- 우리 = we/us (NOT "I")
- Pay special attention to Korean pronouns - they are often mistranslated
- Korean sentence structure: Subject-Object-Verb order, translate meaning correctly
- Consider Korean honorific levels (반말/존댓말) in context

TRANSLITERATION RULES:
- For proper names (people, places, brands), transliterate them into the target language's writing system
- Example: "John" becomes "جون" in Arabic, "ジョン" in Japanese, "约翰" in Chinese
- Example: "McDonald's" becomes "ماكدونالدز" in Arabic, "マクドナルド" in Japanese
- Do NOT translate the meaning of names, only convert the sound/pronunciation
- Keep the same pronunciation but write it in target language script

FINAL RULE: Return ONLY the translated text. Nothing else. No explanations whatsoever.`;
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

        // Only preserve technical items (URLs, mentions, etc.) that shouldn't be changed at all
        const { processedText, nameMap } = markNamesForTransliteration(normalizedText);

        const response = await postMistralWithRetry({
            model: 'mistral-medium-latest',
            messages: [
                {
                    role: 'system',
                    content: systemContent + '\n\nIMPORTANT: Do NOT change placeholder text that looks like "__PRESERVE_X_X__" - keep these placeholders exactly as they are.'
                },
                {
                    role: 'user',
                    content: `Translate this text to ${targetLangName}. Preserve original line breaks and spacing. Transliterate proper names into the target language script. Keep it natural and concise: "${processedText}"`
                }
            ],
            temperature: 0.2,
            // Dynamically set max_tokens but cap it to avoid hitting hard limits
            max_tokens: Math.min(4096, Math.max(400, Math.ceil(normalizedText.length * 1.2))) // Allow sufficient tokens while preventing truncation
        }, apiKey);

        let translation = response.data.choices[0].message.content.trim();
        
        // Remove quotes if they exist around the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) || 
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }
        
        // Remove any explanatory notes or comments that might have slipped through
        translation = removeUnwantedNotes(translation);
        
        // Restore the preserved technical items (URLs, mentions, etc.)
        translation = restorePreservedItems(translation, nameMap);
        
        // Keep full translation lines
        return translation;
    } catch (error) {
        console.error('Error translating text:', error);
        throw new Error('Translation failed');
    }
};

const translateTextToMultipleLanguages = async (text, targetLanguages, sourceLanguage = null, useToneUnderstanding = false, apiKey = MISTRAL_API_KEY) => {
    const translations = {};
    for (const targetLanguage of targetLanguages) {
        translations[targetLanguage] = await translateText(text, targetLanguage, sourceLanguage, useToneUnderstanding, apiKey);
    }
    return translations;
};

module.exports = {
    translateText,
    detectLanguage,
    translateTextToMultipleLanguages
};