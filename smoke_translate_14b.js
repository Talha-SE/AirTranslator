// smoke_translate_14b.js — real translation through the bot's own service,
// exercising TRANSLATION_MODEL (now ministral-14b-latest) + reasoning path.
require('dotenv').config();
const { translateText } = require('./src/services/mistralService');

(async () => {
    const samples = [
        ['Hello, how are you doing today?', 'es'],
        ['I will be late to the meeting, sorry!', 'fr'],
        ['This weather is absolutely amazing.', 'hi'],
    ];
    for (const [text, target] of samples) {
        try {
            const out = await translateText(text, target, 'auto', false);
            console.log(`[${target}] "${text}"  ->  "${out}"`);
        } catch (e) {
            console.error(`[${target}] ERROR: ${e.response?.status || e.code} ${e.response?.data?.message || e.message}`);
        }
    }
})();
