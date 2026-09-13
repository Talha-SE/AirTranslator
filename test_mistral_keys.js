/**
 * test_mistral_keys.js
 *
 * Diagnoses 429 / auth issues across every Mistral API key in .env.
 *
 * For each key it performs TWO checks:
 *   1. GET  /v1/models           -> cheap, validates the key (no tokens).
 *   2. POST /v1/chat/completions -> 1-token request against the real
 *                                   translation model, to see if THAT model
 *                                   is rate-limited (429) for the key.
 *
 * It prints HTTP status, error message, and any rate-limit / retry-after
 * headers so we can tell apart:
 *   - 401/403  : invalid or revoked key
 *   - 429      : rate-limited / quota exhausted (look at retry-after)
 *   - 200      : working
 *
 * Usage:  node test_mistral_keys.js
 *         node test_mistral_keys.js mistral-small-latest   # override model
 */

require('dotenv').config();
const axios = require('axios');

const BASE = 'https://api.mistral.ai/v1';

// Model to probe for the chat test. Defaults to the bot's translation model.
const MODEL = process.argv[2] || 'mistral-medium-latest';

// Every distinct Mistral key present in .env, with a label telling you where
// it is used in the bot. Duplicates (same value, multiple env vars) are kept
// visible so the mapping is explicit.
const KEYS = [
    { label: 'MISTRAL_API_KEY (main)', value: process.env.MISTRAL_API_KEY },
    { label: 'MISTRAL_API_KEY_2', value: process.env.MISTRAL_API_KEY_2 },
    { label: 'MISTRAL_API_KEY_3', value: process.env.MISTRAL_API_KEY_3 },
    { label: 'MISTRAL_API_KEY_4', value: process.env.MISTRAL_API_KEY_4 },
    { label: 'MISTRAL_API_KEY_5', value: process.env.MISTRAL_API_KEY_5 },
    { label: 'MISTRAL_API_KEY_6', value: process.env.MISTRAL_API_KEY_6 },
    { label: 'MISTRAL_DETECT_API_KEY', value: process.env.MISTRAL_DETECT_API_KEY },
    { label: 'MISTRAL_VOICE_API_KEY', value: process.env.MISTRAL_VOICE_API_KEY },
].filter((k) => !!k.value);

const fmtKey = (k) => `${k.slice(0, 6)}...${k.slice(-6)}`;

// Pull the headers we care about out of an axios response/error.
function rateInfo(headers = {}) {
    const pick = (name) => headers[name] ?? headers[name.toLowerCase()] ?? undefined;
    const info = {
        'limit': pick('x-ratelimit-limit-tokens') ?? pick('x-ratelimit-limit-requests') ?? pick('ratelimit-limit'),
        'remaining': pick('x-ratelimit-remaining-tokens') ?? pick('x-ratelimit-remaining-requests') ?? pick('ratelimit-remaining'),
        'retry-after': pick('retry-after'),
    };
    return info;
}

async function checkModels(key) {
    const t0 = Date.now();
    try {
        const res = await axios.get(`${BASE}/models`, {
            headers: { Authorization: `Bearer ${key}` },
            timeout: 20000,
            validateStatus: () => true,
        });
        const data = Array.isArray(res.data?.data) ? res.data.data.length : null;
        return { status: res.status, ms: Date.now() - t0, models: data, headers: res.headers };
    } catch (e) {
        return { status: e.code || 'ERR', ms: Date.now() - t0, err: e.message, headers: {} };
    }
}

async function checkChat(key) {
    const t0 = Date.now();
    try {
        const res = await axios.post(
            `${BASE}/chat/completions`,
            {
                model: MODEL,
                messages: [{ role: 'user', content: 'Say OK.' }],
                max_tokens: 2,
                temperature: 0,
            },
            {
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                timeout: 30000,
                validateStatus: () => true,
            }
        );
        let err = null;
        if (res.status >= 400) {
            err = res.data?.message || res.data?.error?.message || res.data?.detail || JSON.stringify(res.data);
        }
        return { status: res.status, ms: Date.now() - t0, err, headers: res.headers };
    } catch (e) {
        return { status: e.code || 'ERR', ms: Date.now() - t0, err: e.message, headers: {} };
    }
}

function verdict(status) {
    if (status === 200) return 'OK       ';
    if (status === 429) return 'RATE-LIM ';
    if (status === 401 || status === 403) return 'INVALID  ';
    return 'PROBLEM  ';
}

(async () => {
    console.log('='.repeat(78));
    console.log(`Mistral key diagnostic  |  chat model = ${MODEL}`);
    console.log(`Keys found in .env: ${KEYS.length}`);
    console.log('='.repeat(78));

    // Deduplicate by value so we don't hammer the same account N times.
    const seen = new Map();
    for (const k of KEYS) {
        if (!seen.has(k.value)) seen.set(k.value, []);
        seen.get(k.value).push(k.label);
    }
    const unique = [...seen.entries()].map(([value, labels]) => ({ value, labels }));

    const results = [];
    for (const { value, labels } of unique) {
        console.log(`\n>>> ${fmtKey(value)}  [${labels.join(', ')}]`);
        const m = await checkModels(value);
        console.log(`    /models      : ${m.status} ${verdict(m.status)} (${m.ms}ms)` +
            (m.models != null ? `  ${m.models} models visible` : '') +
            (m.err ? `  ${m.err}` : ''));

        // Only do the (token-consuming) chat test if the key authenticated.
        if (m.status === 200) {
            const c = await checkChat(value);
            const ri = rateInfo(c.headers);
            console.log(`    chat/${MODEL.slice(0,18)}: ${c.status} ${verdict(c.status)} (${c.ms}ms)` +
                (c.err ? `  ${c.err}` : '') +
                (ri['retry-after'] ? `\n        retry-after=${ri['retry-after']}s` : '') +
                (ri['remaining'] != null ? `  remaining=${ri['remaining']}` : '') +
                (ri['limit'] != null ? `  limit=${ri['limit']}` : ''));
            results.push({ key: fmtKey(value), labels, auth: m.status, chat: c.status, retry: ri['retry-after'] });
        } else {
            results.push({ key: fmtKey(value), labels, auth: m.status, chat: null, retry: null });
        }

        // Be polite: small gap so we don't trigger a burst 429 ourselves.
        await new Promise((r) => setTimeout(r, 1500));
    }

    console.log('\n' + '='.repeat(78));
    console.log('SUMMARY');
    console.log('='.repeat(78));
    for (const r of results) {
        const chatTxt = r.chat == null ? 'n/a' : r.chat;
        const line = `${r.key}  auth=${r.auth}  chat=${chatTxt}` +
            (r.retry ? `  retry-after=${r.retry}s` : '');
        console.log('  ' + line);
    }
    const working = results.filter((r) => r.chat === 200).map((r) => r.key);
    const rateLimited = results.filter((r) => r.chat === 429).map((r) => r.key);
    const invalid = results.filter((r) => r.auth !== 200).map((r) => r.key);
    console.log('\n  Working keys      :', working.length ? working.join(', ') : 'NONE');
    console.log('  Rate-limited (429):', rateLimited.length ? rateLimited.join(', ') : 'none');
    console.log('  Invalid/auth fail :', invalid.length ? invalid.join(', ') : 'none');
})();
