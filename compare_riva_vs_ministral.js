/**
 * compare_riva_vs_ministral.js
 * Sends the SAME prompt to two models and compares quality + latency:
 *   - Mistral:  ministral-14b-latest        (Mistral endpoint, MISTRAL_API_KEY)
 *   - NVIDIA:   nvidia/riva-translate-4b-instruct-v2  (NVIDIA endpoint, NVIDIA_API_KEY)
 *
 * Direct, isolated calls (no bot retry/fallback) so each row measures that model.
 * Usage: node compare_riva_vs_ministral.js
 */
require('dotenv').config();
const axios = require('axios');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MISTRAL = { url: 'https://api.mistral.ai/v1/chat/completions', key: process.env.MISTRAL_API_KEY, model: 'ministral-14b-latest' };
const NVIDIA  = { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: process.env.NVIDIA_API_KEY, model: 'nvidia/riva-translate-4b-instruct-v2' };

const SYS = 'You are a message translator for a Discord chat. Translate the user message into the requested language. Preserve @mentions, #hashtags, URLs, emoji and proper names exactly. Reply with ONLY the translation, no notes, no quotes.';

// target language + a representative source message (mostly English source).
const SAMPLES = [
    { lang: 'Spanish',    msg: 'Hey @knight, are we still on for the ranked match tonight? 🎮 gg' },
    { lang: 'Hindi',      msg: 'The game servers are down again, see https://status.example.com for updates 🙏' },
    { lang: 'French',     msg: 'I cannot believe Raj finally hit Radiant rank!! insane play #esports' },
    { lang: 'Japanese',   msg: 'Good morning everyone, the tournament stream starts in 10 minutes.' },
    { lang: 'Arabic',     msg: 'Nice shot! That clutch was absolutely incredible, well played team.' },
    { lang: 'German',     msg: 'Does anyone want to join my squad? We need one more player, dm me.' },
    // a non-English source to test direction handling:
    { lang: 'English (from Spanish)', msg: 'Buenas noches a todos, nos vemos en el campo de batalla.' },
];

async function call(ep, lang, msg) {
    const t0 = Date.now();
    try {
        const res = await axios.post(ep.url, {
            model: ep.model,
            messages: [
                { role: 'system', content: SYS },
                { role: 'user', content: `Language: ${lang}\nMessage:\n${msg}` },
            ],
            temperature: 0.2, max_tokens: 512,
        }, { headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' }, timeout: 45000, validateStatus: () => true });
        const ms = Date.now() - t0;
        if (res.status >= 400) return { ms, status: res.status, out: (res.data?.message || res.data?.detail || JSON.stringify(res.data)).toString().slice(0, 120) };
        let c = res.data?.choices?.[0]?.message?.content;
        if (Array.isArray(c)) c = c.map((p) => p.text || p.content || '').join('');
        return { ms, status: res.status, out: (c || '').replace(/\s+/g, ' ').trim() };
    } catch (e) { return { ms: Date.now() - t0, status: e.code || 'ERR', out: e.message }; }
}

(async () => {
    console.log('='.repeat(82));
    console.log(`ministral-14b-latest (Mistral)   vs   ${NVIDIA.model} (NVIDIA)`);
    console.log('='.repeat(82));
    const times = { m: [], n: [] };
    for (const s of SAMPLES) {
        console.log(`\n### ${s.lang}  ::  "${s.msg}"`);
        const m = await call(MISTRAL, s.lang, s.msg);
        const n = await call(NVIDIA, s.lang, s.msg);
        if (m.status === 200) times.m.push(m.ms);
        if (n.status === 200) times.n.push(n.ms);
        console.log(`  MISTRAL (${m.status}, ${m.ms}ms): ${m.out}`);
        console.log(`  RIVA    (${n.status}, ${n.ms}ms): ${n.out}`);
        await sleep(400);
    }
    const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 'n/a';
    console.log('\n' + '='.repeat(82));
    console.log('LATENCY AVERAGE (successful calls only)');
    console.log(`  ministral-14b-latest : ${avg(times.m)} ms   (ok ${times.m.length}/${SAMPLES.length})`);
    console.log(`  riva-translate-4b-v2 : ${avg(times.n)} ms   (ok ${times.n.length}/${SAMPLES.length})`);
    console.log('='.repeat(82));
})();
