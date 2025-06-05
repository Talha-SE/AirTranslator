const axios = require('axios');
const { MISTRAL_API_KEY } = require('../utils/constants');

const mistralAPIUrl = 'https://api.mistral.ai/v1/chat/completions';

const translateText = async (text, targetLanguage) => {
    try {
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

const translateMessage = translateText;

module.exports = {
    translateText,
    translateMessage
};