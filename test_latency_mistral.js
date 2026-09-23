require('dotenv').config();
const axios = require('axios');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

const models = [
    'ministral-14b-latest',
    'codestral-latest',
    'codestral-2501',
    'codestral-2405',
    'mistral-medium-latest',
    'mistral-small-latest',
    'mistral-small-2506',
    'ministral-8b-latest',
    'ministral-3b-latest'
];

const testPrompt = 'Translate to Spanish: "Hello, how are you today?"';

async function testModel(model) {
    const payload = {
        model,
        messages: [{ role: 'user', content: testPrompt }],
        temperature: 0.1,
        max_tokens: 100
    };

    const start = Date.now();
    try {
        const response = await axios.post(MISTRAL_API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000,
            validateStatus: () => true
        });
        const latency = Date.now() - start;
        if (response.status >= 400) {
            return { model, latency, success: false, error: `HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 120)}` };
        }
        const text = response.data.choices[0]?.message?.content || '';
        return { model, latency, success: true, text: text.substring(0, 60) };
    } catch (error) {
        const latency = Date.now() - start;
        return { model, latency, success: false, error: error.message };
    }
}

async function runTests() {
    console.log('Testing latency (Mistral API)...\n');

    for (const model of models) {
        console.log(`Testing ${model}...`);
        const results = [];

        for (let i = 0; i < 3; i++) {
            const result = await testModel(model);
            results.push(result);
            console.log(`  Run ${i + 1}: ${result.latency}ms ${result.success ? '✅ ' + result.text : '❌ ' + result.error}`);
            await new Promise(r => setTimeout(r, 800));
        }

        const successful = results.filter(r => r.success);
        if (successful.length > 0) {
            const avg = successful.reduce((a, b) => a + b.latency, 0) / successful.length;
            console.log(`  Average: ${Math.round(avg)}ms (${successful.length}/3 successful)\n`);
        } else {
            console.log(`  All failed\n`);
        }
    }
}

runTests().catch(console.error);