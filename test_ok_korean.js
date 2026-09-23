require('dotenv').config();
const { translateTextToMultipleLanguages } = require('./src/services/mistralService');

async function run() {
    const tests = [
        { text: 'ok', langs: ['ko'] },
        { text: 'ok', langs: ['ko', 'es', 'fr'] },
        { text: 'okay', langs: ['ko'] },
        { text: 'k', langs: ['ko'] },
    ];

    for (const t of tests) {
        console.log(`\n=== "${t.text}" -> [${t.langs.join(', ')}] ===`);
        const start = Date.now();
        try {
            const result = await translateTextToMultipleLanguages(t.text, t.langs, null, false);
            const ms = Date.now() - start;
            console.log(`  (${ms}ms)`, JSON.stringify(result));
        } catch (e) {
            console.log(`  ERROR: ${e.message}`);
        }
    }
}

run().catch(console.error);