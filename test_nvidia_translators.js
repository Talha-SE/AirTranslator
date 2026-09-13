// test_nvidia_translators.js — live quality+latency test of NVIDIA NIM models
// that are plausible fits for the bot's AUTO-TRANSLATION (text) path.
require('dotenv').config();
const axios = require('axios');
const KEY = process.env.NVIDIA_API_KEY;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Candidate NVIDIA models for translation (org/name). Riva = purpose-built NMT;
// the rest are generalist chat models with strong multilingual ability.
const MODELS = [
    'nvidia/nemotron-3-super-120b-a12b',      // current baseline
    'nvidia/nemotron-3-ultra-550b-a55b',      // bigger, higher quality
    'nvidia/riva-translate-4b-instruct-v2',   // dedicated translation, 37 langs
    'nv-mistralai/mistral-nemo-12b-instruct', // fast multilingual
    'nvidia/mistral-nemo-minitron-8b-8k-instruct', // small+fast
    'meta/llama-3.2-90b-vision-instruct',     // large multilingual
    'deepseek-ai/deepseek-v4-flash-0731',     // fast MoE
];

const SAMPLES = [
    { lang: 'Spanish', text: 'Hey, are we still on for the match tonight?' },
    { lang: 'Hindi', text: 'The servers are down again, please be patient.' },
];

async function probe(model) {
    const out = [];
    let ok = true; let lastErr = '';
    for (const s of SAMPLES) {
        const t0 = Date.now();
        try {
            const res = await axios.post(URL, {
                model,
                messages: [{ role: 'user', content: `Translate the following message into ${s.lang}. Reply with ONLY the translation:\n\n${s.text}` }],
                temperature: 0.2, max_tokens: 200,
            }, { headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, timeout: 45000, validateStatus: () => true });
            const ms = Date.now() - t0;
            if (res.status >= 400) { ok = false; lastErr = `${res.status} ${(res.data?.detail||res.data?.message||'').toString().slice(0,70)}`; out.push(`[${s.lang}] ${lastErr}`); }
            else { const txt = (res.data?.choices?.[0]?.message?.content || '').replace(/\s+/g,' ').trim(); out.push(`[${s.lang}] (${ms}ms) ${txt.slice(0,80)}`); }
        } catch (e) { ok = false; lastErr = e.code || e.message; out.push(`[${s.lang}] ERR ${lastErr}`); }
        await sleep(300);
    }
    return { ok, lines: out };
}

(async () => {
    console.log('='.repeat(80));
    console.log('NVIDIA NIM translation candidates — live test (2 samples each)');
    console.log('='.repeat(80));
    for (const m of MODELS) {
        console.log(`\n>>> ${m}`);
        const r = await probe(m);
        r.lines.forEach((l) => console.log('    ' + l));
        console.log(`    ${r.ok ? '✅ usable' : '❌ ' + (r.lines.find((l)=>/ERR|\d{3} /.test(l))||'failed')}`);
        await sleep(500);
    }
})();
