// Test using the REAL production function + prompt + settings.
// Mirrors the auto-translation path in messageCreate.js:
//   translateTextToMultipleLanguages(text, targetLanguages, null, toneSettings, apiKey)
require('dotenv').config();
const { translateTextToMultipleLanguages } = require('./src/services/mistralService');

const TEXT = 'let me see';
// Discord screenshot showed English + German + Korean → targets are de, ko (batch path)
const TARGETS = ['de', 'ko'];

(async () => {
    console.log(`Production test | text="${TEXT}" | targets=[${TARGETS.join(', ')}]\n`);
    for (let i = 1; i <= 3; i++) {
        const start = Date.now();
        try {
            const result = await translateTextToMultipleLanguages(
                TEXT,
                TARGETS,
                null,          // sourceLanguage: null → model auto-detects (production)
                false,         // useToneUnderstanding (production default)
                process.env.MISTRAL_API_KEY
            );
            const ms = Date.now() - start;
            console.log(`Run ${i} (${ms}ms):`);
            for (const [lang, val] of Object.entries(result)) {
                console.log(`   ${lang}: ${JSON.stringify(val)}`);
            }
        } catch (e) {
            console.log(`Run ${i} ERROR (${Date.now() - start}ms): ${e.message}`);
        }
        console.log('');
        await new Promise(r => setTimeout(r, 500));
    }
})();
