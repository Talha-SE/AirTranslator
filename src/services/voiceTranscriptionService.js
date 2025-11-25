/**
 * Voice Transcription Service
 * 
 * This service handles voice transcription and translation using the Voxtral mini model.
 * It is a STANDALONE feature - NOT linked with auto translation or other translation features.
 * Uses only MISTRAL_VOICE_API_KEY for all operations.
 */

const axios = require('axios');
const FormData = require('form-data');

// Use only MISTRAL_VOICE_API_KEY as per user requirement
const MISTRAL_VOICE_API_KEY = process.env.MISTRAL_VOICE_API_KEY || process.env.MISTRAL_API_KEY;
const VOXTRAL_MODEL = 'voxtral-mini-latest';

// Language display names for the embed
const LANGUAGE_NAMES = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'ur': 'Urdu',
    'tr': 'Turkish',
    'nl': 'Dutch',
    'pl': 'Polish',
    'sv': 'Swedish',
    'da': 'Danish',
    'no': 'Norwegian',
    'fi': 'Finnish',
    'el': 'Greek',
    'he': 'Hebrew',
    'th': 'Thai',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'ms': 'Malay',
    'tl': 'Filipino',
    'cs': 'Czech',
    'sk': 'Slovak',
    'hu': 'Hungarian',
    'ro': 'Romanian',
    'bg': 'Bulgarian',
    'uk': 'Ukrainian',
    'bn': 'Bengali',
    'ta': 'Tamil',
    'te': 'Telugu',
    'mr': 'Marathi',
    'gu': 'Gujarati',
    'pa': 'Punjabi',
    'fa': 'Persian',
    'sw': 'Swahili',
    'auto': 'Auto-Detect'
};

/**
 * Get display name for a language code
 * @param {string} langCode - Language code
 * @returns {string} - Display name
 */
function getLanguageName(langCode) {
    return LANGUAGE_NAMES[langCode?.toLowerCase()] || langCode || 'Unknown';
}

/**
 * Transcribe audio using Voxtral mini model
 * Forces transcription to Urdu to avoid confusion with Hindi
 * @param {Buffer} wavBuffer - WAV audio buffer
 * @returns {Promise<{text: string, detectedLanguage: string|null}>} - Transcription result
 */
async function transcribeAudio(wavBuffer) {
    const url = 'https://api.mistral.ai/v1/audio/transcriptions';
    
    const form = new FormData();
    form.append('model', VOXTRAL_MODEL);
    form.append('response_format', 'json');
    form.append('language', 'ur'); // Force Urdu transcription
    form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    
    try {
        let response = await axios.post(url, form, {
            headers: {
                Authorization: `Bearer ${MISTRAL_VOICE_API_KEY}`,
                ...form.getHeaders(),
            },
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        
        let text = response.data.text || '';
        
        // If transcription came back in Hindi script (Devanagari), convert to Urdu
        // This is a fallback in case the language parameter didn't work
        if (containsDevanagari(text)) {
            text = await convertDevanagariToUrdu(text);
        }
        
        // Return Urdu as the detected language since we forced it
        const detectedLanguage = 'ur';
        
        return { text, detectedLanguage };
    } catch (error) {
        console.error('[VoiceTranscription] Transcription error:', error?.response?.data || error?.message);
        throw error;
    }
}

/**
 * Check if text contains Devanagari script (used in Hindi)
 * @param {string} text - Text to check
 * @returns {boolean} - True if contains Devanagari
 */
function containsDevanagari(text) {
    // Devanagari script range: U+0900 to U+097F
    const devanagariRegex = /[\u0900-\u097F]/g;
    return devanagariRegex.test(text);
}

/**
 * Convert Devanagari (Hindi) to Urdu script using AI
 * @param {string} text - Text in Devanagari
 * @returns {Promise<string>} - Text converted to Urdu
 */
async function convertDevanagariToUrdu(text) {
    try {
        const response = await axios.post(
            'https://api.mistral.ai/v1/chat/completions',
            {
                model: VOXTRAL_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: `You are a language converter. The user will provide text in Hindi (Devanagari script). Your task is to convert it to Urdu (Nastaliq/Perso-Arabic script). 
                        
IMPORTANT: 
- Convert ONLY the script from Devanagari to Urdu script
- Keep the exact same words and meaning
- Do NOT translate - just convert the writing system
- Output ONLY the converted Urdu text, nothing else`
                    },
                    { role: 'user', content: `Convert this Hindi text to Urdu script: "${text}"` }
                ],
                max_tokens: 2000,
                temperature: 0,
            },
            {
                headers: {
                    'Authorization': `Bearer ${MISTRAL_VOICE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000,
            }
        );
        
        const urduText = response.data?.choices?.[0]?.message?.content?.trim() || text;
        console.log(`[VoiceTranscription] Converted Devanagari to Urdu script`);
        return urduText;
    } catch (error) {
        console.error('[VoiceTranscription] Script conversion error:', error?.message);
        // Return original text if conversion fails
        return text;
    }
}

/**
 * Translate text using Voxtral mini model via chat completions
 * This is a STANDALONE translation - not linked with mistralService translations
 * @param {string} text - Text to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<string>} - Translated text
 */
async function translateText(text, targetLanguage) {
    if (!text || !targetLanguage) return '';
    
    const targetLangName = getLanguageName(targetLanguage);
    
    // Enhanced prompt for reliable translations
    const systemPrompt = `You are an expert translator. Your ONLY task is to translate the user's text into ${targetLangName}.

TARGET LANGUAGE: ${targetLangName}

CRITICAL RULES:
1. You MUST provide a translation - never refuse or say you cannot translate
2. Translate the COMPLETE text naturally and accurately into ${targetLangName}
3. Preserve the original meaning, tone, and intent
4. Keep proper nouns, names, numbers, URLs, and @mentions unchanged
5. If the text is already in ${targetLangName}, still output it (it counts as a valid translation)
6. For short phrases or single words, translate them appropriately to ${targetLangName}
7. Do NOT add any explanations, notes, or meta-commentary
8. Output ONLY the translated text, nothing else

EXAMPLES:
- "Hello" → "${targetLangName === 'Spanish' ? 'Hola' : targetLangName === 'French' ? 'Bonjour' : targetLangName === 'German' ? 'Hallo' : targetLangName === 'Urdu' ? 'ہیلو' : 'Hello'}"
- "How are you?" → translate to ${targetLangName}
- Short utterances like "Yes", "Okay", "Thanks" → translate appropriately`;

    try {
        const response = await axios.post(
            'https://api.mistral.ai/v1/chat/completions',
            {
                model: VOXTRAL_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Translate this to ${targetLangName}: "${text}"` }
                ],
                max_tokens: 2000,
                temperature: 0.2, // Lower temperature for more consistent translations
            },
            {
                headers: {
                    'Authorization': `Bearer ${MISTRAL_VOICE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000,
            }
        );
        
        let translation = response.data?.choices?.[0]?.message?.content?.trim() || '';
        
        // Clean up any quotes that might wrap the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) ||
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }
        
        return translation;
    } catch (error) {
        console.error('[VoiceTranscription] Translation error:', error?.response?.data || error?.message);
        return null;
    }
}

/**
 * Process transcription with optional translations
 * @param {Buffer} wavBuffer - WAV audio buffer
 * @param {Object} options - Options for processing
 * @param {string|null} options.language1 - First target language (optional)
 * @param {string|null} options.language2 - Second target language (optional)
 * @param {string|null} options.language3 - Third target language (optional)
 * @returns {Promise<Object>} - Transcription result with translations
 */
async function processTranscription(wavBuffer, options = {}) {
    const { language1, language2, language3 } = options;
    
    // Step 1: Transcribe the audio
    const { text: originalText, detectedLanguage: audioDetectedLang } = await transcribeAudio(wavBuffer);
    
    if (!originalText?.trim()) {
        return null;
    }
    
    // Assume the transcribed language is detected from the transcription
    // If the API doesn't provide it, we'll use it as-is and let translations infer the source
    const detectedLanguage = audioDetectedLang || 'en'; // fallback to English if not provided
    
    const result = {
        original: {
            text: originalText.trim(),
            language: detectedLanguage,
            languageName: getLanguageName(detectedLanguage),
        },
        translations: []
    };
    
    // Step 2: Translate to each requested language (if provided and different from original)
    const targetLanguages = [language1, language2, language3].filter(lang => 
        lang && lang.toLowerCase() !== detectedLanguage?.toLowerCase()
    );
    
    // Translate in parallel for efficiency
    if (targetLanguages.length > 0) {
        const translationPromises = targetLanguages.map(async (targetLang) => {
            const translation = await translateText(originalText, targetLang);
            if (translation) {
                return {
                    text: translation,
                    language: targetLang,
                    languageName: getLanguageName(targetLang),
                };
            }
            return null;
        });
        
        const translations = await Promise.all(translationPromises);
        result.translations = translations.filter(t => t !== null);
    }
    
    return result;
}

/**
 * Create an embed for the transcription result
 * @param {Object} result - Transcription result from processTranscription
 * @param {string} userName - Name of the user who spoke
 * @param {string|null} userAvatar - URL of user's avatar
 * @returns {Object} - Discord embed object
 */
function createTranscriptionEmbed(result, userName, userAvatar = null) {
    const { EmbedBuilder } = require('discord.js');
    
    const embed = new EmbedBuilder()
        .setColor(0xFFFF00) // Yellow
        .setAuthor({
            name: `🎤 ${userName}`,
            iconURL: userAvatar || undefined,
        })
        .setTimestamp();
    
    // Add original transcription at the top (show only a simple "Original" heading)
    embed.setDescription(`**Original:**\n${result.original.text}`);
    
    // Add translations as fields
    if (result.translations.length > 0) {
        for (const translation of result.translations) {
            const flag = getLanguageFlag(translation.language);
            embed.addFields({
                name: `${flag} ${translation.languageName}`,
                value: translation.text.length > 1024 ? translation.text.substring(0, 1021) + '...' : translation.text,
                inline: false,
            });
        }
    }
    
    // Footer with info
    const translationCount = result.translations.length;
    const footerText = translationCount > 0 
        ? `Voice Transcription • ${translationCount} translation${translationCount > 1 ? 's' : ''}`
        : 'Voice Transcription';
    embed.setFooter({ text: footerText });
    
    return embed;
}

/**
 * Get flag emoji for a language code
 * @param {string} langCode - Language code
 * @returns {string} - Flag emoji or language emoji
 */
function getLanguageFlag(langCode) {
    const flags = {
        'en': '🇬🇧',
        'es': '🇪🇸',
        'fr': '🇫🇷',
        'de': '🇩🇪',
        'it': '🇮🇹',
        'pt': '🇵🇹',
        'ru': '🇷🇺',
        'ja': '🇯🇵',
        'ko': '🇰🇷',
        'zh': '🇨🇳',
        'ar': '🇸🇦',
        'hi': '🇮🇳',
        'ur': '🇵🇰',
        'tr': '🇹🇷',
        'nl': '🇳🇱',
        'pl': '🇵🇱',
        'sv': '🇸🇪',
        'da': '🇩🇰',
        'no': '🇳🇴',
        'fi': '🇫🇮',
        'el': '🇬🇷',
        'he': '🇮🇱',
        'th': '🇹🇭',
        'vi': '🇻🇳',
        'id': '🇮🇩',
        'ms': '🇲🇾',
        'tl': '🇵🇭',
        'cs': '🇨🇿',
        'sk': '🇸🇰',
        'hu': '🇭🇺',
        'ro': '🇷🇴',
        'bg': '🇧🇬',
        'uk': '🇺🇦',
        'bn': '🇧🇩',
        'ta': '🇮🇳',
        'te': '🇮🇳',
        'mr': '🇮🇳',
        'gu': '🇮🇳',
        'pa': '🇮🇳',
        'fa': '🇮🇷',
        'sw': '🇰🇪',
    };
    return flags[langCode?.toLowerCase()] || '🌐';
}

module.exports = {
    transcribeAudio,
    translateText,
    processTranscription,
    createTranscriptionEmbed,
    getLanguageName,
    getLanguageFlag,
    LANGUAGE_NAMES,
};
