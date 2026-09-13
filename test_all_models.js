/**
 * test_all_models.js
 *
 * Pulls the full list of models your key can see (GET /v1/models), then sends
 * ONE tiny chat request (max_tokens=1) to every model and records the HTTP
 * status. This tells you exactly which models are usable right now:
 *   200 = works   429 = rate-limited/quota   403 = no entitlement
 *   404 = model id wrong   400 = not a chat model (embeddings/audio/ocr)
 *
 * Usage: node test_all_models.js            # probes with MISTRAL_API_KEY
 *          node test_all_models.js <envVar>  # e.g. MISTRAL_API_KEY_3
 */
require('dotenv').config();
const axios = require('axios');

const BASE = 'https://api.mistral.ai/v1';
const ENV_VAR = process.argv[2] || 'MISTRAL_API_KEY';
const KEY = process.env[ENV_VAR];
if (!KEY) { console.error(`No key in env var ${ENV_VAR}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (k) => `${k.slice(0, 6)}...${k.slice(-4)}`;
const verdict = (s) => ({ 200: 'OK ✅', 429: 'RATE-LIMIT(429) ⛔', 403: 'NO-ACCESS(403) 🔒', 404: 'NOT-FOUND(404)', 400: 'BAD-REQ(400)', 422: 'BAD-REQ(422)' }[s] || `HTTP ${s}`);

async function listModels() {
    const res = await axios.get(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` }, timeout: 20000 });
    return (res.data?.data || []).map((m) => m.id).filter(Boolean).sort();
}

async function probe(model) {
    const t0 = Date.now();
    try {
        const res = await axios.post(`${BASE}/chat/completions`,
            { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, temperature: 0 },
            { headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true });
        let err = null;
        if (res.status >= 400) err = res.data?.message || res.data?.error?.message || res.data?.detail || '';
        return { model, status: res.status, ms: Date.now() - t0, err };
    } catch (e) {
        return { model, status: e.code || 'ERR', ms: Date.now() - t0, err: e.message };
    }
}

(async () => {
    console.log('='.repeat(70));
    console.log(`Probing ALL models on key ${fmt(KEY)} [${ENV_VAR}]`);
    console.log('='.repeat(70));
    const models = await listModels();
    console.log(`Found ${models.length} models. Testing each with a 1-token chat request...\n`);
    const results = [];
    for (const m of models) {
        const r = await probe(m);
        results.push(r);
        const msg = r.err ? `  ${String(r.err).replace(/\s+/g, ' ').slice(0, 60)}` : '';
        console.log(`  ${String(r.status).padEnd(4)} ${verdict(r.status).padEnd(18)} ${m.padEnd(38)} ${r.ms}ms${msg}`);
        await sleep(400); // polite gap
    }
    const ok = results.filter((r) => r.status === 200).map((r) => r.model);
    const rl = results.filter((r) => r.status === 429).map((r) => r.model);
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`\n✅ WORKING (${ok.length}):`);
    ok.forEach((m) => console.log('   ' + m));
    console.log(`\n⛔ RATE-LIMITED / 429 (${rl.length}):`);
    rl.forEach((m) => console.log('   ' + m));
})();
