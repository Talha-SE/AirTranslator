// test_current_model.js — test current model latency
require('dotenv').config();
const axios = require('axios');
const KEY = process.env.NVIDIA_API_KEY;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function testModel(model) {
    const samples = [
        { lang: 'Spanish', text: 'Hey, are we still on for the match tonight?' },
        { lang: 'Hindi', text: 'The servers are down again, please be patient.' },
        { lang: 'Korean', text: 'Hello, how are you doing today?' }
    ];
    
    console.log('Testing:', model);
    for (const s of samples) {
        const t0 = Date.now();
        try {
            const res = await axios.post(URL, {
                model,
                messages: [{ role: 'user', content: `Translate the following message into ${s.lang}. Reply with ONLY the translation:\n\n${s.text}` }],
                temperature: 0.2, max_tokens: 200,
            }, { headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, timeout: 45000, validateStatus: () => true });
            const ms = Date.now() - t0;
            if (res.status >= 400) {
                console.log(`  [${s.lang}] ${res.status} ${(res.data?.detail||res.data?.message||'').toString().slice(0,70)}`);
            } else {
                const txt = (res.data?.choices?.[0]?.message?.content || '').replace(/\s+/g,' ').trim();
                console.log(`  [${s.lang}] (${ms}ms) ${txt.slice(0,100)}`);
            }
        } catch (e) {
            console.log(`  [${s.lang}] ERR ${e.code || e.message}`);
        }
        await new Promise(r => setTimeout(r, 300));
    }
}

testModel('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');