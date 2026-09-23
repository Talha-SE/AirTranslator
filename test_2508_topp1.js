require('dotenv').config();
const axios = require('axios');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

const MODEL = 'codestral-2508';
const TOP_P = 1; // test-only override

const SYS = `You are a message translator for a Discord chat. Translate the user message into the requested language. Preserve @mentions, #hashtags, URLs, emoji and proper names exactly. Reply with ONLY the translation, no notes, no quotes.`;

async function call(text, lang) {
    const start = Date.now();
    try {
        const res = await axios.post(MISTRAL_API_URL, {
            model: MODEL,
            messages: [
                { role: 'system', content: SYS },
                { role: 'user', content: `Translate to ${lang}: "${text}"` }
            ],
            temperature: 0.2,
            top_p: TOP_P,
            max_tokens: 200
        }, {
            headers: { 'Authorization': `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 30000,
            validateStatus: () => true
        });
        const ms = Date.now() - start;
        if (res.status >= 400) return { ms, status: res.status, out: JSON.stringify(res.data).slice(0, 150) };
        return { ms, status: res.status, out: res.data.choices[0]?.message?.content?.trim() };
    } catch (e) {
        return { ms: Date.now() - start, status: 'ERR', out: e.message };
    }
}

(async () => {
    console.log(`Model: ${MODEL} | top_p: ${TOP_P} | temperature: 0.2\n`);
    const tests = [
        { text: 'ok', lang: 'Korean' },
        { text: 'ok', lang: 'Korean' },
        { text: 'ok', lang: 'Korean' },
        { text: 'okay', lang: 'Korean' },
        { text: 'ok', lang: 'Spanish' },
    ];
    for (const t of tests) {
        const r = await call(t.text, t.lang);
        console.log(`"${t.text}" -> ${t.lang}: (${r.status}, ${r.ms}ms) ${r.out}`);
        await new Promise(r => setTimeout(r, 500));
    }
})();