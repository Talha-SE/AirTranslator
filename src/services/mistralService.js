const axios = require('axios');
const { MISTRAL_API_KEY, AUTO_DETECT_LANGUAGE } = require('../utils/constants');

const mistralAPIUrl = 'https://api.mistral.ai/v1/chat/completions';

const detectLanguage = async (text) => {
    try {
        const response = await axios.post(mistralAPIUrl, {
            model: 'mistral-small-latest',
            messages: [
                {
                    role: 'system',
                    content: 'You are a language detector. Only respond with the ISO language code (en, fr, es, de, it, etc). No explanation or additional text.'
                },
                {
                    role: 'user',
                    content: `Detect the language of this text and respond only with the language code: "${text}"`
                }
            ],
            temperature: 0.1,
            max_tokens: 10
        }, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            }
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

const translateText = async (text, targetLanguage, sourceLanguage = null) => {
    try {
        // If target language is "auto", we don't need to translate
        if (targetLanguage === AUTO_DETECT_LANGUAGE) {
            return text;
        }

        // If no source language is provided and target isn't auto, detect the language
        if (!sourceLanguage && targetLanguage !== AUTO_DETECT_LANGUAGE) {
            sourceLanguage = await detectLanguage(text);
        }

        // If the detected source language is the same as the target, no translation needed
        if (sourceLanguage && sourceLanguage === targetLanguage) {
            return text;
        }

        const response = await axios.post(mistralAPIUrl, {
            model: 'mistral-small-latest',
            messages: [
                {
                    role: 'system',
                    content: 'You are a translator. Only provide the direct translation without any explanations, additional text, or formatting. Return only the translated text.'
                },
                {
                    role: 'user',
                    content: `Translate this text to ${targetLanguage}: "${text}"`
                }
            ],
            temperature: 0.1,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        let translation = response.data.choices[0].message.content.trim();
        
        // Remove quotes if they exist around the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) || 
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }
        
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