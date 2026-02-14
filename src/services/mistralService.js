const axios = require('axios');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// High-performance HTTP agents and a dedicated Axios instance to reuse TCP/TLS connections
const http = require('http');
const https = require('https');
const keepAliveHttpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 256,
    maxFreeSockets: 64,
    timeout: 180000,
    keepAliveMsecs: 150000,
    freeSocketTimeout: 180000,
});
const keepAliveHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 256,
    maxFreeSockets: 64,
    timeout: 180000,
    keepAliveMsecs: 150000,
    freeSocketTimeout: 180000,
});
const axiosMistral = axios.create({
    httpAgent: keepAliveHttpAgent,
    httpsAgent: keepAliveHttpsAgent,
    timeout: 45000,
    decompress: true,
    headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    },
});

// Simple per-API-key concurrency limiter to prevent 429s and reduce latency spikes
const MAX_PARALLEL_PER_KEY = 2;
const keySemaphores = new Map(); // apiKey -> { active, queue: [fn] }
const withKeySemaphore = (apiKey, fn) => {
    const key = apiKey || 'default';
    if (!keySemaphores.has(key)) keySemaphores.set(key, { active: 0, queue: [] });
    const sem = keySemaphores.get(key);
    return new Promise((resolve, reject) => {
        const run = async () => {
            sem.active++;
            try {
                const res = await fn();
                resolve(res);
            } catch (e) {
                reject(e);
            } finally {
                sem.active--;
                const next = sem.queue.shift();
                if (next) next();
            }
        };
        if (sem.active < MAX_PARALLEL_PER_KEY) run(); else sem.queue.push(run);
    });
};

// Lightweight LRU cache with TTL
class LRUCache {
    constructor(max = 500, ttlMs = 10 * 60 * 1000) {
        this.max = max;
        this.ttl = ttlMs;
        this.map = new Map();
    }
    _now() { return Date.now(); }
    get(key) {
        const ent = this.map.get(key);
        if (!ent) return null;
        if (ent.exp <= this._now()) { this.map.delete(key); return null; }
        // refresh LRU order
        this.map.delete(key);
        this.map.set(key, ent);
        return ent.val;
    }
    set(key, val, ttlMs) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, { val, exp: this._now() + (ttlMs ?? this.ttl) });
        if (this.map.size > this.max) {
            const firstKey = this.map.keys().next().value;
            this.map.delete(firstKey);
        }
    }
}

const detectionCache = new LRUCache(1000, 10 * 60 * 1000);
const translationCache = new LRUCache(800, 10 * 60 * 1000);

// In-flight request de-duplication
const inflight = new Map();
const withInflight = (key, createFn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
        try { return await createFn(); }
        finally { inflight.delete(key); }
    })();
    inflight.set(key, p);
    return p;
};

/**
 * Detects and marks proper names for transliteration (not translation)
 * @param {string} text - The original text
 * @returns {object} - Object containing processed text and name mappings
 */
const markNamesForTransliteration = (text) => {
    const nameMap = new Map();
    let processedText = text;

    // Patterns to detect names and proper nouns that should be transliterated, not translated
    const patterns = [
        // @mentions - preserve completely
        /@\w+/g,
        // #hashtags - preserve completely
        /#\w+/g,
        // URLs - preserve completely
        /https?:\/\/[^\s]+/g,
        // Discord user/channel mentions - preserve completely
        /<[@#&!]\d+>/g,
        // Email addresses - preserve completely
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
    ];

    // Items that should be preserved completely (not even transliterated)
    patterns.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        matches.forEach(match => {
            if (nameMap.has(match)) return;
            
            const placeholder = `__PRESERVE_${index}_${nameMap.size}__`;
            nameMap.set(placeholder, match);
            processedText = processedText.replace(new RegExp(escapeRegExp(match), 'g'), placeholder);
        });
    });

    return { processedText, nameMap };
};

/**
 * Restores preserved items in translated text
 * @param {string} translatedText - The translated text with placeholders
 * @param {Map} nameMap - Map of placeholders to original items
 * @returns {string} - Text with preserved items restored
 */
const restorePreservedItems = (translatedText, nameMap) => {
    let restoredText = translatedText;
    
    // First try exact matching
    nameMap.forEach((originalItem, placeholder) => {
        restoredText = restoredText.replace(new RegExp(escapeRegExp(placeholder), 'g'), originalItem);
    });
    
    // Then try fuzzy matching for common placeholder modifications
    nameMap.forEach((originalItem, placeholder) => {
        // Extract the pattern parts: __PRESERVE_0_1__ -> [0, 1]
        const match = placeholder.match(/__PRESERVE_(\d+)_(\d+)__/);
        if (match) {
            const [, index, count] = match;
            
            // Try common variations that Mistral might generate
            const variations = [
                `PRESERVE_${index}_${count}`,  // Missing underscores
                `__PRESERVE_${index}_${count}`, // Missing trailing underscores
                `PRESERVE_${index}_${count}__`, // Missing leading underscores
                `PRESERVE_X_X`,  // Generic X replacement
                `__PRESERVE_X_X__`,  // Generic X with underscores
                `PRESERVE_X_${count}`,  // Partial X replacement
                `PRESERVE_${index}_X`,  // Partial X replacement
            ];
            
            variations.forEach(variation => {
                restoredText = restoredText.replace(new RegExp(escapeRegExp(variation), 'g'), originalItem);
            });
        }
    });
    
    return restoredText;
};

/**
 * Escapes special regex characters in a string
 * @param {string} string - String to escape
 * @returns {string} - Escaped string
 */
const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Normalize elongated sequences to improve language detection and translation stability.
 * - Compresses alphabetic character runs of length >= 5 down to 3 (heyyyyy -> heyyy)
 * - Leaves numbers, emojis, URLs, mentions, hashtags, and special tokens unaffected (best-effort)
 */
const normalizeElongatedText = (text) => {
    if (!text || typeof text !== 'string') return text;
    // Only compress ASCII letters to avoid impacting CJK or other scripts
    return text.replace(/([A-Za-z])\1{4,}/g, '$1$1$1');
};

/**
 * Emoji utilities for strict preservation behavior
 */
const EMOJI_REGEX = /[\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
const hasEmoji = (text) => {
    if (!text) return false;
    return EMOJI_REGEX.test(text);
};
const extractEmojis = (text) => {
    if (!text) return [];
    return (text.match(EMOJI_REGEX) || []);
};
const stripEmojis = (text) => {
    if (!text) return text;
    return text.replace(EMOJI_REGEX, '');
};

// Filters translation emojis to only those present in the allowed set, respecting counts
const filterEmojisToAllowed = (text, allowedEmojis) => {
    if (!text) return text;
    if (!allowedEmojis || allowedEmojis.length === 0) return stripEmojis(text);
    // Build count map from allowed emojis (source counts)
    const allowedCounts = new Map();
    for (const e of allowedEmojis) {
        allowedCounts.set(e, (allowedCounts.get(e) || 0) + 1);
    }
    // Replace any emoji exceeding counts or not in allowed set
    return text.replace(EMOJI_REGEX, (m) => {
        const left = allowedCounts.get(m) || 0;
        if (left > 0) {
            allowedCounts.set(m, left - 1);
            return m; // keep
        }
        return ''; // remove extra or disallowed emoji
    });
};

const romanUrduKeywords = new Set([
    'hai', 'hain', 'he', 'hoon', 'ho', 'hona', 'nahi', 'nai', 'nah', 'acha', 'achha', 'accha', 'theek', 'thik',
    'kaisa', 'kesa', 'kaise', 'kese', 'kyun', 'kyu', 'kya', 'kaam', 'kar', 'kr', 'karo', 'karna', 'karunga',
    'karungi', 'karoge', 'karenge', 'raha', 'rahe', 'rahi', 'rha', 'rhe', 'rhi', 'rahen', 'rahay', 'chalo',
    'chalein', 'jana', 'jaon', 'jao', 'jaungi', 'jaunga', 'aya', 'aaya', 'aao', 'aana', 'aap', 'ap', 'aapka',
    'apka', 'aapki', 'apki', 'aapke', 'apke', 'tum', 'tera', 'teri', 'tumhara', 'tumhari', 'tumhare', 'mere',
    'mera', 'meri', 'mujhe', 'mujhko', 'hum', 'ham', 'hamara', 'hamari', 'hamare', 'humara', 'humari', 'humare',
    'ammi', 'amma', 'abbu', 'abba', 'bhai', 'behan', 'baji', 'bhaiya', 'yaar', 'dost', 'beta', 'beti', 'bhooka',
    'bhooki', 'bhook', 'bhookh', 'pyaar', 'pyar', 'mohabbat', 'ishq', 'jazakallah', 'inshallah', 'allah', 'khuda',
    'dua', 'zindagi', 'masla', 'maslay', 'hal', 'halaat', 'wahan', 'yahan', 'yahaan', 'haan', 'han', 'jee', 'ji',
    'bohot', 'bahut', 'bohut', 'zaroor', 'bilkul', 'thoda', 'thora', 'thori', 'zara', 'jaldi', 'der', 'raat',
    'subha', 'shaam', 'kal', 'aaj', 'subha', 'shaam', 'raat', 'zara', 'thoda', 'thora', 'thori'
]);

const englishStopwords = new Set([
    'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'an', 'and', 'or', 'for', 'with', 'this',
    'that', 'these', 'those', 'of', 'to', 'from', 'in', 'on', 'at', 'it', 'its', 'you', 'your', 'yours', 'we',
    'our', 'ours', 'i', 'me', 'my', 'mine', 'they', 'them', 'their', 'theirs', 'he', 'she', 'his', 'her', 'hers',
    'but', 'if', 'then', 'else'
]);

const romanUrduRegex = /\b(?:main|mein|mai|tum|tera|teri|tumhara|tumhari|tumhare|aap|ap|aapka|apka|aapki|apki|aapke|apke|mera|meri|mere|mujhe|mujhko|hum|ham|humara|humari|humare|hamara|hamari|hamare|wahan|yahan|yahaan|haan|han|bohot|bahut|bohut|shukriya|jazakallah|inshallah|allah|khuda|zindagi|dost|yaar|bhai|behan|raha|rahe|rahi|unga|ungi|ega|egi|onga|ongi|lo|karo|karna|mat|nah|nahi|nai|kese|kaise|kaisa|kesa|acha|achha|accha|beta|beti|ammi|abbu|bhook|pyar|pyaar|ishq|sabar|meherbani|maaf|kya|kyun|kyu|abhi|kal|aaj|subha|shaam|raat|zara|thoda|thora|thori)\b/g;

const romanUrduDigraphRegex = /\b[a-z]*(?:kh|gh|bh|ph|sh|ch|aa|oo|uu|iy|ay|ai|au|qa)[a-z]*\b/g;

const isRomanUrdu = (text) => {
    if (!text || typeof text !== 'string') return false;
    const plain = stripEmojis(text);
    if (/[^\n\r\t\x20-\x7E]/.test(plain)) return false;
    const lower = plain.toLowerCase();
    const words = lower.replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    let keywordScore = 0;
    for (const word of words) {
        if (romanUrduKeywords.has(word)) keywordScore += 2;
    }
    const regexMatches = lower.match(romanUrduRegex);
    const digraphMatches = lower.match(romanUrduDigraphRegex);
    const englishMatches = words.reduce((acc, word) => englishStopwords.has(word) ? acc + 1 : acc, 0);
    const score = keywordScore + (regexMatches ? regexMatches.length : 0) + (digraphMatches ? Math.min(digraphMatches.length, 3) : 0);
    const romanRatio = score / words.length;
    const englishRatio = englishMatches / words.length;
    if (score >= 5 && romanRatio >= 0.3) return true;
    if (score >= 3 && romanRatio >= 0.2 && romanRatio > englishRatio + 0.05) return true;
    if (score >= 2 && romanRatio >= 0.25 && englishMatches <= 1 && words.length <= 4) return true;
    return false;
};

/**
 * Removes unwanted explanatory notes from translations
 * @param {string} translation - The translated text
 * @returns {string} - Clean translation without notes
 */
const removeUnwantedNotes = (translation) => {
    // Remove common note patterns
    const notePatterns = [
        /\(Note:.*?\)/gi,
        /\(Translation:.*?\)/gi,
        /\(The original.*?\)/gi,
        /\(This.*?\)/gi,
        /\(Please note.*?\)/gi,
        /\(Literal.*?\)/gi,
        /\(Alternative.*?\)/gi,
        /\(More natural.*?\)/gi,
        /\(Context:.*?\)/gi,
        /\(Explanation:.*?\)/gi,
        // Remove standalone explanatory sentences that start common ways
        /\n\s*Note:.*?(?=\n|$)/gi,
        /\n\s*Translation:.*?(?=\n|$)/gi,
        /\n\s*The original.*?(?=\n|$)/gi,
        /\n\s*This translation.*?(?=\n|$)/gi,
    ];
    
    let cleanTranslation = translation;
    notePatterns.forEach(pattern => {
        cleanTranslation = cleanTranslation.replace(pattern, '');
    });
    
    // Clean up extra whitespace left behind
    cleanTranslation = cleanTranslation.replace(/\n\s*\n/g, '\n').trim();
    
    return cleanTranslation;
};

/**
 * Degenerate repetition detection and clamping utilities
 * Detects looping outputs and collapses them while preserving natural chat elongations
 */
const REP_ALLOWED_CHAT_CHARS = new Set(['ㅋ', 'ㅎ', 'ㅠ', 'ㅜ', 'w', '~']);

// Heuristic detector for degenerate repetition
const hasDegenerateRepetition = (text, sourceLength = 0) => {
    if (!text) return { isDegenerate: false };
    const len = text.length;

    // Extremely long same-character or short n-gram runs
    const repetitiveRun = /(.)(\1){24,}/u.test(text); // any char repeated >= 25
    const repetitivePair = /(.{1,4})\1{12,}/u.test(text); // 1-4 char n-gram repeated >= 13

    // Diversity ratio (unique chars / length)
    const unique = new Set(Array.from(text)).size;
    const diversity = unique / Math.max(1, len);

    // Length skew relative to source
    const lengthSkew = sourceLength > 0 ? len > sourceLength * 6 : len > 2000;
    const tooLowDiversity = diversity < 0.12 && len > 80;

    const isDegenerate = repetitiveRun || repetitivePair || (lengthSkew && tooLowDiversity);
    return { isDegenerate, diversity, len };
};

// Clamp excessive repetitions while preserving reasonable chat elongations
const clampRepetitions = (text) => {
    if (!text) return text;
    let out = text;

    // Limit single-character runs. Allow a bit more for common chat chars.
    out = out.replace(/(.)\1{8,}/gu, (match, ch) => {
        const cap = REP_ALLOWED_CHAT_CHARS.has(ch) ? 12 : 6;
        return ch.repeat(cap);
    });

    // Limit short n-gram repeats (1-4 chars)
    for (let n = 1; n <= 4; n++) {
        const re = new RegExp(`(.{${n}})\\1{10,}`, 'gu');
        out = out.replace(re, (m, g1) => g1.repeat(8));
    }

    // Collapse duplicate words repeated 5+ times
    out = out.replace(/(\b\S+\b)(?:\s+\1){4,}/gu, (m, w) => `${w} ${w} ${w}`);

    // Trim overly long tails of the same line content
    out = out.split('\n').map(line => {
        if (line.length > 1500) {
            return line.slice(0, 1500) + '…';
        }
        return line;
    }).join('\n');

    return out.trim();
};

// Decoding control helpers
// Stop sequences to discourage the model from adding explanations/notes
const STOP_SEQUENCES = [
    "\nNote:",
    "\nTranslation:",
    "\nExplanation:",
    "(Note:",
    "(Translation:",
    "(Explanation:"
];

// Stable 32-bit unsigned seed derived from input to make outputs deterministic per input
const stableRandomSeed = (str) => {
    let h = 2166136261; // FNV-1a basis
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
};

/**
 * Analyzes the tone and context of a message to provide better translation context
 * @param {string} text - The text to analyze
 * @returns {object} - Tone analysis results
 */
const analyzeToneContext = (text) => {
    const analysis = {
        emotions: [],
        formality: 'neutral',
        intensity: 'medium',
        features: []
    };

    const lowerText = text.toLowerCase();

    // Emotion detection patterns
    const emotionPatterns = {
        excited: /(!{2,}|wow|omg|amazing|awesome|great|love it|fantastic|incredible|yay|woohoo|🎉|🔥|💯)/i,
        happy: /(😊|😄|😁|🙂|😍|❤️|♥️|💕|happy|joy|glad|pleased|thrilled|delighted|cheerful)/i,
        sad: /(😢|😭|😞|💔|sad|cry|sorry|depressed|upset|disappointed|heartbroken|miserable)/i,
        angry: /(😠|😡|angry|mad|furious|damn|hate|stupid|annoying|frustrated|irritated|pissed)/i,
        sarcastic: /(oh sure|yeah right|totally|obviously|of course|wow such|so amazing|really\?|sure thing|how wonderful)/i,
        worried: /(worried|concern|afraid|scared|nervous|anxiety|hope not|stressed|anxious|unsure)/i,
        affectionate: /(dear|honey|love|sweetheart|darling|babe|cutie|❤️|😘|💕|💖|baby|sweetie|beloved|babyyy|bby|hun|hunny|sugar|princess|prince)/i,
        playful: /(hehe|haha|lol|lmao|😂|🤣|teasing|kidding|joking|playful|silly|fun|hihi|hehehe|ㅋㅋ|ㅎㅎ)/i,
        confident: /(definitely|absolutely|certainly|for sure|no doubt|obviously|clearly|of course)/i,
        uncertain: /(maybe|perhaps|possibly|might|could be|not sure|i think|probably|dunno)/i,
        grateful: /(thank you|thanks|grateful|appreciate|blessed|thankful|much appreciated)/i,
        apologetic: /(sorry|apologize|my bad|oops|forgive me|excuse me|pardon)/i,
        casual_greeting: /(hey|hi|yo|sup|wassup|what's up|howdy|hiya)/i,
        korean_cute: /(ㅠㅠ|ㅜㅜ|><|♡|ㅋㅋ|ㅎㅎ)/i
    };

    // Check for emotions
    Object.entries(emotionPatterns).forEach(([emotion, pattern]) => {
        if (pattern.test(text)) {
            analysis.emotions.push(emotion);
        }
    });

    // Formality level detection
    const formalPatterns = /\b(please|thank you|sir|madam|would you|could you|may I|sincerely|respectfully|kindly|regards|cordially|professionally|formally|officially)\b/i;
    const casualPatterns = /\b(hey|hi|yo|sup|gonna|wanna|yeah|nah|lol|lmao|brb|tbh|omg|btw|fyi|idk|wtf|damn|shit|dude|bro|sis)\b/i;
    const intimatePatterns = /\b(love|honey|babe|dear|sweetheart|miss you|xoxo|darling|baby|cutie|my heart|beloved|treasure)\b/i;
    const professionalPatterns = /\b(meeting|deadline|project|report|analysis|proposal|regarding|furthermore|however|therefore|consequently)\b/i;

    if (formalPatterns.test(text) || professionalPatterns.test(text)) {
        analysis.formality = 'formal';
    } else if (intimatePatterns.test(text)) {
        analysis.formality = 'intimate';
    } else if (casualPatterns.test(text)) {
        analysis.formality = 'casual';
    }

    // Intensity detection
    const highIntensityPatterns = /(!{3,}|\?{3,}|[A-Z]{4,}|CAPS|amazing|incredible|terrible|awful|fantastic|outstanding|catastrophic|devastating|brilliant|magnificent)/i;
    const lowIntensityPatterns = /(maybe|perhaps|kinda|sorta|i guess|not sure|possibly|might be|could be|somewhat|slightly)/i;

    if (highIntensityPatterns.test(text)) {
        analysis.intensity = 'high';
    } else if (lowIntensityPatterns.test(text)) {
        analysis.intensity = 'low';
    }

    // Special features
    if (/(.)\1{2,}/.test(text)) analysis.features.push('elongation');
    if (/(baby+y+|hey+|love+|babe+y+|hun+y+|sweet+y+)/i.test(text)) analysis.features.push('affectionate_elongation');
    if (/(hey{4,}|baby{4,}|love{4,}|hiii+|nooo+|yesss+|pleaseee+)/i.test(text)) analysis.features.push('extreme_elongation');
    if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(text)) analysis.features.push('emojis');
    if (/[.]{3,}/.test(text)) analysis.features.push('ellipsis');
    if (/[!]{2,}/.test(text)) analysis.features.push('emphasis');
    if (/@\w+/.test(text)) analysis.features.push('mentions');
    if (/#\w+/.test(text)) analysis.features.push('hashtags');
    if (/\b[A-Z]{2,}\b/.test(text)) analysis.features.push('caps');
    if (/\?\?+/.test(text)) analysis.features.push('multiple_questions');
    if (/~{2,}/.test(text)) analysis.features.push('tildes');
    if (/(baby+y+|love+|cute+|sweet+).*~+/i.test(text)) analysis.features.push('affectionate_tildes');
    if (/(ㅋㅋ|ㅎㅎ|ㅠㅠ|ㅜㅜ|><|♡)/i.test(text)) analysis.features.push('korean_chatting');
    if (/\*\w+\*/.test(text)) analysis.features.push('asterisk_emphasis');
    if (/\b(haha|hehe|lol|lmao|rofl)\b/i.test(text)) analysis.features.push('laughter');
    if (/\b\w+(-\w+)+\b/.test(text)) analysis.features.push('hyphenated_words');
    if (/\b\w*[0-9]+\w*\b/.test(text)) analysis.features.push('text_numbers');
};

/**
 * Helper to POST to Mistral with automatic retries on 429 or network errors.
 * First retry switches to an alternate model before continuing normal backoff logic.
 * @param {object} payload - JSON body for chat/completions
 * @param {number} maxRetries - maximum retry attempts
 * @param {string} [apiKey] - Optional custom API key
 */
const RETRY_MODELS = {
    alternate: 'mistral-small-2409',
};

const postMistralWithRetry = async (payload, maxRetries = 3, apiKey = MISTRAL_API_KEY) => {
    let attempt = 0;
    let originalModel = payload.model;
    let hasTriedAlternate = false;
    
    while (true) {
        try {
            const inflightKey = `${apiKey}|${payload.model}|${stableRandomSeed(JSON.stringify(payload.messages))}|${payload.max_tokens}`;
            return await withKeySemaphore(apiKey, () => withInflight(inflightKey, () => axiosMistral.post(mistralAPIUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })));
        } catch (err) {
            const status = err.response?.status;
            
            // If this is the first retry, switch to alternate model if available
            if (!hasTriedAlternate) {
                const alternateModel = RETRY_MODELS.alternate;
                if (alternateModel && alternateModel !== payload.model) {
                    console.warn(`Mistral request failed with model ${payload.model} (status ${status || 'network'}). Trying alternate model (${alternateModel})`);
                    payload.model = alternateModel;
                    hasTriedAlternate = true;
                    attempt = 0;
                    continue;
                }
                hasTriedAlternate = true;
            }

            // Retry on 429 and transient 5xx (e.g., 502/503/504). Network errors (no status) are also retried.
            const retriableStatuses = new Set([429, 502, 503, 504]);
            if (attempt >= maxRetries || (status && !retriableStatuses.has(status))) {
                // Restore original model before throwing error
                payload.model = originalModel;
                throw err;
            }
            
            // Prefer server-provided Retry-After when present
            let retryAfterHeader = err.response?.headers?.['retry-after'];
            let retryAfterMs = 0;
            if (retryAfterHeader) {
                const parsed = parseFloat(retryAfterHeader);
                if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
                    retryAfterMs = parsed * 1000;
                }
            }
            const jitter = Math.random() * 500;
            const expBackoff = (2 ** attempt) * 1000 + jitter;
            const backoff = Math.min(120000, Math.max(retryAfterMs, expBackoff));
            console.warn(`Mistral request failed (${payload.model}) (status ${status}). Retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(backoff);
            attempt++;
        }
    }
};

const { MISTRAL_API_KEY, AUTO_DETECT_LANGUAGE } = require('../utils/constants');
const DETECT_API_KEY = process.env.MISTRAL_DETECT_API_KEY || MISTRAL_API_KEY;

const mistralAPIUrl = 'https://api.mistral.ai/v1/chat/completions';
//const TRANSLATION_MODEL = 'mistral-small-2501';
//const TRANSLATION_MODEL = 'mistral-small-2503';
//const TRANSLATION_MODEL = 'voxtral-small-2507';
//const TRANSLATION_MODEL = 'devstral-small-latest';
//const TRANSLATION_MODEL = 'mistral-medium-2508';
const TRANSLATION_MODEL = 'mistral-small-2506';
//const TRANSLATION_MODEL = 'ministral-14b-latest';
const THINKING_MODE_ENABLED = true; // Enable thinking mode for ministral-14b-latest
/**
 * Detects the language of a given text
 * @param {string} text - The text to detect the language for
 * @returns {string} - The detected language code
 */
const detectLanguage = async (text, apiKey = DETECT_API_KEY) => {
    try {
        // Normalize the text before detection
        const normalizedText = normalizeElongatedText(text);
        // Fast path: cache
        const cached = detectionCache.get(normalizedText);
        if (cached) return cached;
        
        const response = await postMistralWithRetry({
            model: 'mistral-tiny-latest',
            messages: [
                {
                    role: 'system',
                    content: 'You are a language detector. Analyze the text and respond with ONLY the ISO language code (en, fr, es, de, it, ko, ur, etc). Consider informal writing, slang, and elongated words. No explanation or additional text.'
                },
                {
                    role: 'user',
                    content: `Detect the language of this text and respond only with the language code: "${normalizedText}"`
                }
            ],
            temperature: 0.2,
            max_tokens: 10
        }, 3, apiKey);

        let langCode = response.data.choices[0].message.content.trim().toLowerCase();
        // Clean up the language code (remove quotes, punctuation, etc.)
        langCode = langCode.replace(/[^\w]/g, '');
        if ((!langCode || langCode === 'en' || langCode === 'und' || langCode === 'id' || langCode === 'ms' || langCode === 'pt') && isRomanUrdu(normalizedText)) {
            langCode = 'ur';
        }
        if (!langCode) langCode = 'en';
        detectionCache.set(normalizedText, langCode);
        return langCode;
    } catch (error) {
        console.error('Error detecting language:', {
            error: error?.message || error,
            stack: error?.stack,
            statusCode: error?.response?.status,
            apiKeyPresent: !!apiKey,
            textLength: normalizedText?.length || 0
        });
        return 'en'; // Default to English if detection fails
    }
};

const translateText = async (text, targetLanguage, sourceLanguage = null, useToneUnderstanding = false, apiKey = MISTRAL_API_KEY, modelOverride = null) => {
    try {
        // If target language is "auto", we don't need to translate
        if (targetLanguage === AUTO_DETECT_LANGUAGE) {
            return text;
        }

        // Enable thinking mode (tone understanding) automatically for ministral-14b-latest model
        const effectiveModel = modelOverride || TRANSLATION_MODEL;
        if (THINKING_MODE_ENABLED && effectiveModel === 'ministral-14b-latest') {
            useToneUnderstanding = true;
            console.log('🧠 Thinking mode enabled for ministral-14b-latest model');
        }

        // Normalize elongated text before translation
        const normalizedText = normalizeElongatedText(text);

        // Fast no-op: emojis-only or numbers/punctuation-only
        const noEmojiText = stripEmojis(normalizedText).trim();
        if (noEmojiText.length === 0) return text; // emojis only
        if (/^[\d\s\p{P}]+$/u.test(noEmojiText)) return text; // only digits/punct

        // If no source language is provided and target isn't auto, detect the language
        if (!sourceLanguage && targetLanguage !== AUTO_DETECT_LANGUAGE) {
            sourceLanguage = await detectLanguage(normalizedText);
        }

        // If the detected source language is the same as the target, no translation needed
        if (sourceLanguage && sourceLanguage === targetLanguage) {
            return text;
        }

        // Cache key (safe: depends only on inputs and flags)
        const cacheKey = `${modelOverride || TRANSLATION_MODEL}|${sourceLanguage || 'auto'}|${targetLanguage}|${useToneUnderstanding ? 'tone' : 'plain'}|${normalizedText}`;
        const cached = translationCache.get(cacheKey);
        if (cached) return cached;

        // --- Handle very long texts by translating in smaller chunks to avoid context/token limits ---
        const MAX_CHUNK_LENGTH = 2500; // characters, chosen to stay comfortably within provider limits
        if (normalizedText.length > MAX_CHUNK_LENGTH) {
            // Split text on natural boundaries (newline or space) close to the limit
            const chunks = [];
            let remaining = normalizedText;
            while (remaining.length > MAX_CHUNK_LENGTH) {
                let splitIdx = remaining.lastIndexOf('\n', MAX_CHUNK_LENGTH);
                if (splitIdx === -1) {
                    splitIdx = remaining.lastIndexOf(' ', MAX_CHUNK_LENGTH);
                }
                if (splitIdx === -1 || splitIdx < MAX_CHUNK_LENGTH * 0.5) {
                    splitIdx = MAX_CHUNK_LENGTH; // fallback to hard split
                }
                chunks.push(remaining.slice(0, splitIdx + 1));
                remaining = remaining.slice(splitIdx + 1);
            }
            if (remaining.length) {
                chunks.push(remaining);
            }

            // Translate each processed chunk in parallel and concatenate the results
            // Only preserve technical items across all chunks
            const { processedText: allProcessedText, nameMap } = markNamesForTransliteration(normalizedText);
            
            // Re-split the processed text into chunks
            const processedChunks = [];
            let processedRemaining = allProcessedText;
            while (processedRemaining.length > MAX_CHUNK_LENGTH) {
                let splitIdx = processedRemaining.lastIndexOf('\n', MAX_CHUNK_LENGTH);
                if (splitIdx === -1) {
                    splitIdx = processedRemaining.lastIndexOf(' ', MAX_CHUNK_LENGTH);
                }
                if (splitIdx === -1 || splitIdx < MAX_CHUNK_LENGTH * 0.5) {
                    splitIdx = MAX_CHUNK_LENGTH;
                }
                processedChunks.push(processedRemaining.slice(0, splitIdx + 1));
                processedRemaining = processedRemaining.slice(splitIdx + 1);
            }
            if (processedRemaining.length) {
                processedChunks.push(processedRemaining);
            }
            
            // Translate each processed chunk (shorter text won't trigger chunking again)
            const translatedChunks = await Promise.all(
                processedChunks.map(chunk => 
                    translateText(chunk, targetLanguage, sourceLanguage, useToneUnderstanding, apiKey, modelOverride)
                )
            );
            
            // Restore preserved items in the final result
            const finalTranslation = translatedChunks.join('');
            return restorePreservedItems(finalTranslation, nameMap);
        }

        // Create appropriate system prompt based on tone understanding setting
        let systemContent = `You are a professional native translator. Translate text accurately while preserving meaning and same style. Give complete accurate translation and complete meaningful sentences.

CRITICAL GRAMMATICAL RULES:
- Preserve the grammatical subject-object relationships exactly as in the source
- The sentence agent (who performs the action) must remain the same in translation
- Never swap subjects and objects or change who is doing the action
- Pay strict attention to grammatical particles (가/이, を, etc.) that mark subjects and objects
- Maintain the original perspective and point of view (first person, third person, etc.)
- If the source has a proper name as subject, keep it as subject in translation

FORMATTING & CONTENT RULES:
- Preserve original formatting: line breaks, spacing, punctuation, symbols, emojis.
- Do not add/remove/translate emojis or emoticons; keep positions unchanged.
- Keep digits as digits (5 → 5); translate only linguistic parts (e.g., 5th, dates, codes).
- Treat Roman Urdu as Urdu and translate naturally.
- Detect names (people/places/brands); transliterate to target script (same name, not meaning).
- Preserve tone and formality; make the result natural in the target language.
- Mirror playful elongation where natural; otherwise keep meaning without artificial repeats.
- Keep URLs, emails, @mentions, #hashtags, and inline code (text enclosed in backticks) exactly as-is; do not translate them.
- Preserve markup and placeholders (Markdown/HTML tags, variables like {name}, {{var}}, and format specifiers like %s); never alter, remove, or translate them.
- Preserve capitalization patterns (ALL CAPS, Title Case, camelCase, StudlyCaps) and repeated punctuation (e.g., "!!!", "??").
- Do not reorder sentences, list items, or segments; maintain original sequence and segmentation.
- Return the complete sentence in the desired translation language with correct terminal punctuation appropriate to that language (., !, ?, etc.).

CRITICAL SPACING & LINK RULES:
- Preserve ALL spacing around links: if a link is on a new line in source, keep it on a new line in translation
- Keep exact number of blank lines between sections (\n\n stays \n\n)
- Links must appear in EXACTLY the same position with same surrounding spacing
- Do NOT move emojis from end of line to middle or vice versa
- Maintain bullet points (•) or list markers in exact same positions
- Example: "text (link)" stays "translated text (link)" with same spacing

SENTENCE CORRECTION (prior to translation):
- Before translating, minimally correct obvious typos, spacing, and basic punctuation/grammar without changing meaning; do not rewrite or paraphrase.
- Translate the corrected version; if no correction is needed, translate the original verbatim.

If input appears meaningless:
- Convert letter-by-letter to target language sounds
- Never comment on the input
- Never add disclaimers

FINAL RULE: Return ONLY the translated text. Nothing else. No explanations whatsoever.`;

        if (useToneUnderstanding) {
            systemContent = `You are an expert cultural translator with advanced emotional intelligence. Your role is to perfectly preserve the author's intent, emotional state, formality level, and cultural context while adapting the message naturally to the target language.

CRITICAL GRAMMATICAL RULES:
- Preserve the grammatical subject-object relationships exactly as in the source
- The sentence agent (who performs the action) must remain the same in translation
- Never swap subjects and objects or change who is doing the action
- Pay strict attention to grammatical particles (가/이, を, etc.) that mark subjects and objects
- Maintain the original perspective and point of view (first person, third person, etc.)
- If the source has a proper name as subject, keep it as subject in translation

CORE TRANSLATION PHILOSOPHY:
- Understand the FEELING and INTENT behind each word, not just literal meaning
- Preserve the author's emotional state: excitement, frustration, joy, sarcasm, worry, affection, etc.
- Match the formality level: casual chat, professional, intimate, respectful, playful
- Adapt cultural context while preserving the original meaning and impact
- Maintain conversational flow and natural rhythm in the target language

ADVANCED TONE PRESERVATION:
- SARCASM/IRONY: Preserve the ironic undertone using target language's sarcastic patterns
- HUMOR: Adapt jokes and wordplay to work in target culture while keeping the humor intent
- EMOTION INTENSITY: Match emotional intensity (excited vs calm, angry vs annoyed)
- AFFECTION LEVELS: Preserve intimacy levels in relationships (formal, friendly, romantic, familial)
- FORMALITY SPECTRUM: Adapt from ultra-casual to highly formal based on original tone
- CULTURAL IDIOMS: Replace idioms with equivalent expressions that carry same cultural weight
- GENERATIONAL LANGUAGE: Match age-appropriate language patterns (teen slang, professional, elderly)
- ELONGATED EXPRESSIONS: For terms like "babyyy", "heyyyy", "loveeee" - preserve the playful elongation in target language
  * Korean: "babyyy" → "베이비이이~~♡" or "자기야야야~~~ㅎㅎ" or "애기야야~~~ㅋㅋ"
  * Japanese: "babyyy" → "ベイビーー" or "赤ちゃ〜ん", add ー or 〜 for elongation
  * Spanish: "babyyy" → "bebééé" or "amorrrr", use accent repetition
  * French: "babyyy" → "bébééé" or "chériiii", repeat final vowels
  * Arabic: Add ـ (tatweel) or repeat final letters for emphasis
  * Chinese: Repeat characters (嗨嗨嗨嗨, 宝贝贝贝贝) or particles (啊啊啊啊)
CRITICAL: Match the LENGTH of elongation from original text!`;

            // Add specific elongation instructions if elongation is detected
            if (/(.)\1{4,}/.test(text)) {
                systemContent += `\n\nELONGATION TRANSLATION GUIDE:
- Korean: Use vowel/consonant repetition + chatting elements (야야야야~~~, 베이비이이이~~ㅋㅋ, 어이이이이~~~♡)
- Japanese: Use ー for long vowels (ベイビーーー, おーーい) or 〜 for casual tone
- Spanish: Repeat vowels with intensity (hoooolaaaa, bebééééé, amorrrrrr)
- French: Repeat final vowels (salutttttt, chériiiiii, coucouuuuu)  
- Arabic: Use tatweel ـ to extend (هــــاي, حبيبـــــي) or repeat letters
- Chinese: Repeat characters (嗨嗨嗨嗨, 宝贝贝贝贝) or particles (啊啊啊啊)
CRITICAL: Match the LENGTH of elongation from original text!`;
            }
            
            // Add specific tilde instructions if tildes are detected
            if (/(~{2,})/.test(text)) {
                systemContent += `\n\nTILDE CUTENESS GUIDE:
- Korean: Add cute chatting elements (야야야~~~, 베이비이이~~ㅋㅋ, 안뇽~~~♡, 자기야야~~~ㅎㅎ)
- Japanese: Use 〜 naturally (ベイビー〜〜, かわいい〜〜〜)
- Spanish: Keep tildes or use cute endings (bebé~~~, lindooo~~~)
- French: Add cute expressions (bébé~~~, mignon~~~)
- Arabic: Use decorative marks or sweet expressions (حبيبي~~~, يا قمر~~~)
- Chinese: Add cute particles (宝贝~~~, 可爱~~~)
PRESERVE the playful, cute, affectionate feeling of tildes!`;
            }

            // Add specific Korean chatting instructions if Korean chatting elements are detected OR if elongation + affection is detected
            if (/(ㅋㅋ|ㅎㅎ|ㅠㅠ|ㅜㅜ|><|♡)/i.test(text) || 
                (/(.)\1{4,}/.test(text) && /(baby+y+|love+|cute+|sweet+)/i.test(text))) {
                systemContent += `\n\nKOREAN CHATTING STYLE MANDATORY:
For Korean translations, you MUST add cute chatting elements:
- "hey babyyy" → "야야야 베이비이이~~~♡" or "어이이 자기야야~~ㅎㅎ" 
- Add ~~~, ㅋㅋ, ㅎㅎ, ♡, or >< to show cuteness
- Never translate elongated affectionate terms to plain Korean without chat elements
- Example: WRONG: "야 자기야야" → CORRECT: "야야야~~~ 베이비이이♡" or "어이이 자기야야~~~ㅎㅎ"`;
            }
        }

        // Get language names for better context
        const getLanguageName = (code) => {
            const languages = {
                'en': 'English',
                'es': 'Spanish', 
                'fr': 'French',
                'de': 'German',
                'it': 'Italian',
                'pt': 'Portuguese',
                'pt-BR': 'Portuguese (Brazil)',
                'ko': 'Korean',
                'ja': 'Japanese',
                'zh': 'Chinese (Simplified)',
                'zh-TW': 'Chinese (Traditional)',
                'taiwanese': 'Chinese (Traditional)',
                'tawaiese': 'Chinese (Traditional)',
                'tawainese hoekin': 'Chinese (Traditional)',
                'hi': 'Hindi',
                'bn': 'Bengali',
                'pa': 'Punjabi',
                'ta': 'Tamil',
                'te': 'Telugu',
                'mr': 'Marathi',
                'ur': 'Urdu',
                'ar': 'Arabic',
                'fa': 'Persian',
                'tr': 'Turkish',
                'ru': 'Russian',
                'uk': 'Ukrainian',
                'pl': 'Polish',
                'nl': 'Dutch',
                'sv': 'Swedish',
                'fi': 'Finnish',
                'da': 'Danish',
                'no': 'Norwegian',
                'th': 'Thai',
                'vi': 'Vietnamese',
                'id': 'Indonesian',
                'ms': 'Malay',
                'fil': 'Filipino',
                'he': 'Hebrew',
                'el': 'Greek',
                'hu': 'Hungarian',
                'cs': 'Czech',
                'ro': 'Romanian',
                'bg': 'Bulgarian',
                'sr': 'Serbian',
                'hr': 'Croatian',
                'sk': 'Slovak',
                'sl': 'Slovenian',
                'lt': 'Lithuanian',
                'lv': 'Latvian',
                'et': 'Estonian',
                'sw': 'Swahili',
                'af': 'Afrikaans',
                'zu': 'Zulu',
                'xh': 'Xhosa',
                'ne': 'Nepali',
                'si': 'Sinhala',
                'my': 'Burmese',
                'km': 'Khmer',
                'lo': 'Lao',
                'am': 'Amharic',
                'ti': 'Tigrinya',
                'or': 'Odia',
                'as': 'Assamese',
                'gu': 'Gujarati',
                'kn': 'Kannada',
                'ml': 'Malayalam',
                'sd': 'Sindhi',
                'ps': 'Pashto',
                'ku': 'Kurdish',
                'tk': 'Turkmen',
                'uz': 'Uzbek',
                'kk': 'Kazakh',
                'ky': 'Kyrgyz',
                'tg': 'Tajik',
                'mn': 'Mongolian',
                'bo': 'Tibetan'
            };
       
            
            return languages[code] || code;
        };

        const targetLangName = getLanguageName(targetLanguage);

        // Only preserve technical items (URLs, mentions, etc.) that shouldn't be changed at all
        const { processedText, nameMap } = markNamesForTransliteration(normalizedText);

        // Prepare dynamic hard constraints based on source text
        const sourceHasEmoji = hasEmoji(normalizedText);
        const sourceEmojis = extractEmojis(normalizedText);
        const sourceHasNonEmojiText = stripEmojis(normalizedText).trim().length > 0;
        let dynamicHardConstraints = '';
        if (!sourceHasEmoji) {
            dynamicHardConstraints += '\n\nHARD CONSTRAINT: The source contains no emojis. The output MUST NOT contain any emoji characters.';
        } else {
            const list = Array.from(new Set(sourceEmojis)).join(' ');
            dynamicHardConstraints += `\n\nHARD CONSTRAINT: Preserve exactly these emojis in their original positions and do NOT add any new emojis: ${list}`;
        }
        if (sourceHasNonEmojiText) {
            dynamicHardConstraints += '\n\nHARD CONSTRAINT: The source contains non-emoji text. The translation MUST include corresponding non-emoji text. Do NOT reply with emojis only.';
        }

        // Prepare system content without placeholder instructions if no placeholders are needed
        let finalSystemContent = systemContent + dynamicHardConstraints;
        if (nameMap.size > 0) {
            finalSystemContent += '\n\nCRITICAL: You will see placeholder text that looks like "__PRESERVE_0_1__" or "__PRESERVE_1_2__" etc. These are special markers for technical content. Keep these placeholders EXACTLY as they appear - do not modify the numbers, underscores, or any part of them. Do not create your own placeholders.';
        } else {
            finalSystemContent += '\n\nIMPORTANT: Do not create any placeholder text or markers. Translate the text directly and naturally.';
        }
        // Add strictest instruction for translation-only output
        finalSystemContent += '\n\nSTRICT: If you output anything except the translation, it will be discarded. Output ONLY the translation, with no extra text, no commentary, and no formatting.';

        const response = await postMistralWithRetry({
            model: modelOverride || TRANSLATION_MODEL,
            messages: [
                {
                    role: 'system',
                    content: finalSystemContent
                },
                {
                    role: 'user',
                    content: `Translate to ${targetLangName}: "${processedText}"`
                }
            ],
            // Low temperature to reduce creative drift and repetition
            temperature: 0.3,
            top_p: 0.1,
            // Deterministic per input to improve stability across retries
            random_seed: stableRandomSeed(processedText + ':' + targetLangName),
            // Stop when model tries to add notes/explanations
            stop: STOP_SEQUENCES,
            // Dynamically set max_tokens but cap it to avoid hitting hard limits
            max_tokens: Math.min(4096, Math.max(120, Math.ceil(normalizedText.length * 1.2))) // Lower floor for short inputs
        }, 3, apiKey);

        let translation = response.data.choices[0].message.content.trim();

        // Remove quotes if they exist around the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) || 
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }

        // Remove any explanatory notes or comments that might have slipped through
        translation = removeUnwantedNotes(translation);

        // Remove any lines that look like "thinking..." or non-translation output
        translation = translation.split('\n').filter(line => !/^\s*thinking\b/i.test(line) && !/^\s*thoughts?\b/i.test(line)).join('\n').trim();

        // Restore the preserved technical items (URLs, mentions, etc.)
        translation = restorePreservedItems(translation, nameMap);

        // Enforce emoji policy based on source
        if (sourceHasEmoji) {
            translation = filterEmojisToAllowed(translation, sourceEmojis);
        } else {
            translation = stripEmojis(translation);
        }

        // If model returned only emojis but source had non-emoji text, retry once with stricter instruction
        const translationHasNonEmojiText = stripEmojis(translation).trim().length > 0;
        if (sourceHasNonEmojiText && !translationHasNonEmojiText) {
            try {
                const retryMessages = [
                    { role: 'system', content: finalSystemContent + '\n\nHARD CONSTRAINT: Your output must contain the full textual translation. Do NOT reply with emojis only.' },
                    { role: 'user', content: `Translate to ${targetLangName}: "${processedText}"` }
                ];
                const retryResponse = await postMistralWithRetry({
                    model: 'mistral-small-latest',
                    messages: retryMessages,
                    temperature: 0.1,
                    random_seed: stableRandomSeed(processedText + ':' + targetLangName + ':emoji-retry'),
                    stop: STOP_SEQUENCES,
                    max_tokens: Math.min(4096, Math.max(120, Math.ceil(normalizedText.length * 1.2)))
                }, 3, apiKey);
                let retryTranslation = retryResponse.data.choices[0].message.content.trim();
                if ((retryTranslation.startsWith('"') && retryTranslation.endsWith('"')) ||
                    (retryTranslation.startsWith("'") && retryTranslation.endsWith("'"))) {
                    retryTranslation = retryTranslation.slice(1, -1);
                }
                retryTranslation = removeUnwantedNotes(retryTranslation);
                retryTranslation = restorePreservedItems(retryTranslation, nameMap);
                if (sourceHasEmoji) {
                    retryTranslation = filterEmojisToAllowed(retryTranslation, sourceEmojis);
                } else {
                    retryTranslation = stripEmojis(retryTranslation);
                }
                if (stripEmojis(retryTranslation).trim().length > 0) {
                    translation = retryTranslation;
                } else {
                    console.warn('⚠️ Retry still produced emoji-only translation; keeping original.');
                }
            } catch (e) {
                console.warn('⚠️ Retry failed:', e.message || e);
            }
        }

        // Anti-repetition guard (after emoji-only retry)
        let repCheck = hasDegenerateRepetition(translation, normalizedText.length);
        if (repCheck.isDegenerate) {
            try {
                const strictSystem = finalSystemContent + `\n\nHARD CONSTRAINTS (Anti-Repetition):\n- Do NOT repeat any single character more than 6 times in a row.\n- Do NOT repeat syllables or short chunks unnaturally.\n- Output must be concise, natural sentences.\n- If input is short, keep output short.\n- Absolutely avoid loops like "ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ" beyond 12 or any character spam.`;
                const retryResponse = await postMistralWithRetry({
                    model: modelOverride || TRANSLATION_MODEL,
                    messages: [
                        { role: 'system', content: strictSystem },
                        { role: 'user', content: `Translate to ${targetLangName}: "${processedText}"` }
                    ],
                    temperature: 0.1,
                    top_p: 0.95,
                    random_seed: stableRandomSeed(processedText + ':' + targetLangName + ':anti-rep'),
                    stop: STOP_SEQUENCES,
                    max_tokens: Math.min(4096, Math.max(120, Math.ceil(normalizedText.length * 1.2)))
                }, 3, apiKey);
                let retry = retryResponse.data.choices[0].message.content.trim();
                if ((retry.startsWith('"') && retry.endsWith('"')) || (retry.startsWith("'") && retry.endsWith("'"))) {
                    retry = retry.slice(1, -1);
                }
                retry = removeUnwantedNotes(retry);
                retry = restorePreservedItems(retry, nameMap);
                retry = sourceHasEmoji ? filterEmojisToAllowed(retry, sourceEmojis) : stripEmojis(retry);
                const retryCheck = hasDegenerateRepetition(retry, normalizedText.length);
                if (!retryCheck.isDegenerate && stripEmojis(retry).trim().length > 0) {
                    translation = retry;
                } else {
                    translation = clampRepetitions(translation);
                }
            } catch (_) {
                translation = clampRepetitions(translation);
            }
        }

        // Clean up any rogue placeholders that Mistral created on its own
        if (nameMap.size === 0) {
            // If we had no original placeholders, remove any that Mistral created
            translation = translation.replace(/__PRESERVE_\d+_\d+__/g, '');
            translation = translation.replace(/PRESERVE_\d+_\d+/g, '');
            translation = translation.replace(/PRESERVE_X_X/g, '');
        }
        
        // Debug: Check if any placeholders remain
        if (translation.includes('PRESERVE_')) {
            console.log('⚠️ DEBUG: Found remaining placeholder in translation:', translation);
            console.log('⚠️ DEBUG: nameMap keys:', Array.from(nameMap.keys()));
            console.log('⚠️ DEBUG: nameMap size:', nameMap.size);
            console.log('⚠️ DEBUG: Original text:', normalizedText);
        }
        
        // Final anti-repetition safety net
        repCheck = hasDegenerateRepetition(translation, normalizedText.length);
        if (repCheck.isDegenerate) {
            translation = clampRepetitions(translation);
        }

        // Keep full translation lines
        translationCache.set(cacheKey, translation);
        return translation;

    } catch (error) {
        console.error('Error translating text:', {
            error: error?.message || error,
            stack: error?.stack,
            statusCode: error?.response?.status,
            statusText: error?.response?.statusText,
            apiKeyPresent: !!apiKey,
            model: modelOverride || TRANSLATION_MODEL,
            targetLanguage,
            sourceLanguage,
            textLength: text?.length || 0
        });
        throw new Error('Translation failed');
    }
};

const translateTextToMultipleLanguages = async (text, targetLanguages, sourceLanguage = null, useToneUnderstanding = false, apiKey = MISTRAL_API_KEY, modelOverride = null) => {
    const translations = {};
    
    // If only one language, use the regular single translation
    if (targetLanguages.length === 1) {
        let detected = sourceLanguage;
        try {
            if (!detected) {
                detected = await detectLanguage(text);
            }
        } catch (_) {
            detected = sourceLanguage;
        }
        
        try {
            translations[targetLanguages[0]] = await translateText(
                text,
                targetLanguages[0],
                detected,
                useToneUnderstanding,
                apiKey,
                modelOverride
            );
        } catch (error) {
            console.error(`❌ Error translating to ${targetLanguages[0]}:`, error?.message || error);
            translations[targetLanguages[0]] = null;
        }
        return translations;
    }
    
    // BATCH TRANSLATION: Single API call for multiple languages
    try {
        console.log(`🚀 [Translation] Starting batch translation for ${targetLanguages.length} languages`);
        
        // Normalize elongated text before translation
        const normalizedText = normalizeElongatedText(text);
        
        // Fast no-op checks
        const noEmojiText = stripEmojis(normalizedText).trim();
        if (noEmojiText.length === 0 || /^[\d\s\p{P}]+$/u.test(noEmojiText)) {
            // Return original text for all languages
            targetLanguages.forEach(lang => {
                translations[lang] = text;
            });
            return translations;
        }
        
        // Detect source language if not provided
        let detected = sourceLanguage;
        if (!detected) {
            detected = await detectLanguage(normalizedText);
        }
        
        // Check if any target language matches source - skip those
        const languagesToTranslate = targetLanguages.filter(lang => lang !== detected);
        if (languagesToTranslate.length === 0) {
            // All target languages = source language, return original
            targetLanguages.forEach(lang => {
                translations[lang] = text;
            });
            return translations;
        }
        
        // Get language names for better prompt context
        const languageMap = {
            'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
            'pt': 'Portuguese', 'pt-BR': 'Portuguese (Brazil)', 'ko': 'Korean', 'ja': 'Japanese',
            'zh': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)', 'taiwanese': 'Chinese (Traditional)',
            'tawaiese': 'Chinese (Traditional)', 'tawainese hoekin': 'Chinese (Traditional)',
            'hi': 'Hindi', 'bn': 'Bengali', 'pa': 'Punjabi', 'ta': 'Tamil', 'te': 'Telugu',
            'mr': 'Marathi', 'ur': 'Urdu', 'ar': 'Arabic', 'fa': 'Persian', 'tr': 'Turkish',
            'ru': 'Russian', 'uk': 'Ukrainian', 'pl': 'Polish', 'nl': 'Dutch', 'sv': 'Swedish',
            'fi': 'Finnish', 'da': 'Danish', 'no': 'Norwegian', 'th': 'Thai', 'vi': 'Vietnamese',
            'id': 'Indonesian', 'ms': 'Malay', 'fil': 'Filipino', 'he': 'Hebrew', 'el': 'Greek',
            'hu': 'Hungarian', 'cs': 'Czech', 'ro': 'Romanian', 'bg': 'Bulgarian', 'sr': 'Serbian',
            'hr': 'Croatian', 'sk': 'Slovak', 'sl': 'Slovenian', 'lt': 'Lithuanian', 'lv': 'Latvian',
            'et': 'Estonian', 'sw': 'Swahili', 'af': 'Afrikaans', 'zu': 'Zulu', 'xh': 'Xhosa',
            'ne': 'Nepali', 'si': 'Sinhala', 'my': 'Burmese', 'km': 'Khmer', 'lo': 'Lao',
            'am': 'Amharic', 'ti': 'Tigrinya', 'or': 'Odia', 'as': 'Assamese', 'gu': 'Gujarati',
            'kn': 'Kannada', 'ml': 'Malayalam', 'sd': 'Sindhi', 'ps': 'Pashto', 'ku': 'Kurdish',
            'tk': 'Turkmen', 'uz': 'Uzbek', 'kk': 'Kazakh', 'ky': 'Kyrgyz', 'tg': 'Tajik',
            'mn': 'Mongolian', 'bo': 'Tibetan'
        };

        const nameToCodeMap = {};
        Object.entries(languageMap).forEach(([code, name]) => {
            nameToCodeMap[name.toLowerCase()] = code;
        });

        const getLanguageName = (code) => languageMap[code] || code;
        const getLanguageCode = (name) => nameToCodeMap[name ? name.toLowerCase() : ''] || name;
        
        const targetLanguageNames = languagesToTranslate.map(code => `${getLanguageName(code)} (${code})`).join(', ');
        
        // Preserve technical items (URLs, mentions, etc.)
        const { processedText, nameMap } = markNamesForTransliteration(normalizedText);
        
        // Build comprehensive system prompt for batch translation
        let systemContent = `You are a professional native translator. Translate text accurately while preserving meaning and style.

CRITICAL BATCH TRANSLATION INSTRUCTIONS:
1. You will translate ONE message into MULTIPLE languages: ${targetLanguageNames}
2. Return ONLY a raw JSON object where keys are language codes and values are translations
3. NO markdown code blocks (no \`\`\`json), NO explanations, NO prefixes - ONLY the JSON object
4. Each translation must follow ALL grammatical and formatting rules below

GRAMMATICAL RULES:
- Preserve subject-object relationships exactly as in source
- Never swap subjects and objects or change who is doing the action
- Pay strict attention to grammatical particles (가/이, を, etc.)
- Maintain original perspective and point of view
- If source has a proper name as subject, keep it as subject in translation

FORMATTING & CONTENT RULES:
- Preserve original formatting: line breaks, spacing, punctuation, symbols, emojis
- Do not add/remove/translate emojis or emoticons; keep positions unchanged
- Keep digits as digits (5 → 5); translate only linguistic parts
- Treat Roman Urdu as Urdu and translate naturally
- Detect names (people/places/brands); transliterate to target script
- Preserve tone and formality; make result natural in target language
- Mirror playful elongation where natural
- Keep URLs, emails, @mentions, #hashtags, inline code exactly as-is
- Preserve markup and placeholders (Markdown/HTML tags, variables like {name}, {{var}})
- Preserve capitalization patterns (ALL CAPS, Title Case, camelCase)
- Do not reorder sentences or list items; maintain original sequence
- Return complete sentences with correct terminal punctuation`;

        if (useToneUnderstanding) {
            systemContent += `\n\nADVANCED TONE PRESERVATION:
- Preserve emotional state: excitement, frustration, joy, sarcasm, worry, affection
- Match formality level: casual chat, professional, intimate, respectful, playful
- Adapt cultural context while preserving original meaning and impact
- Maintain conversational flow and natural rhythm
- ELONGATED EXPRESSIONS: For "babyyy", "heyyyy", "loveeee" - preserve playful elongation:
  * Korean: "babyyy" → "베이비이이~~♡" or "자기야야야~~~ㅎㅎ"
  * Japanese: "babyyy" → "ベイビーー", add ー or 〜
  * Spanish: "bebééé" or "amorrrr", repeat vowels
- Match LENGTH of elongation from original text!`;
        }
        
        if (nameMap.size > 0) {
            systemContent += '\n\nCRITICAL: Keep placeholder text like "__PRESERVE_0_1__" EXACTLY as they appear in ALL translations.';
        } else {
            systemContent += '\n\nDo not create any placeholder text or markers.';
        }
        
        systemContent += `\n\nOUTPUT FORMAT EXAMPLE:
{"en": "Hello world", "es": "Hola mundo", "ko": "안녕하세요"}

Return ONLY the JSON object. Nothing else.`;
        
        // Make single API call for all languages
        const languageCodesStr = languagesToTranslate.join(', ');
        const response = await postMistralWithRetry({
            model: modelOverride || TRANSLATION_MODEL,
            messages: [
                {
                    role: 'system',
                    content: systemContent
                },
                {
                    role: 'user',
                    content: `Translate to language codes [${languageCodesStr}]:

"${processedText}"`
                }
            ],
            temperature: 0.3,
            top_p: 0.95,
            random_seed: stableRandomSeed(processedText + ':batch:' + languageCodesStr),
            max_tokens: Math.min(4096, Math.max(500, Math.ceil(normalizedText.length * languagesToTranslate.length * 1.5)))
        }, 3, apiKey);
        
        let resultText = response.data.choices[0].message.content.trim();
        
        // Clean markdown code blocks if present
        if (resultText.includes('```')) {
            resultText = resultText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        }
        
        // Remove any leading/trailing text before/after JSON
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            resultText = jsonMatch[0];
        }
        
        // Parse JSON response
        const parsed = JSON.parse(resultText);
        
        // Get emoji constraints from source
        const sourceHasEmoji = hasEmoji(normalizedText);
        const sourceEmojis = extractEmojis(normalizedText);
        const sourceHasNonEmojiText = stripEmojis(normalizedText).trim().length > 0;
        
        // Process each translation
        for (const langCode of languagesToTranslate) {
            const name = getLanguageName(langCode);
            const code = getLanguageCode(langCode);
            
            // Try various key formats to catch what the model returned
            // It might return code (es), name (Spanish), lower name (spanish), or original input (english)
            let translation = 
                parsed[langCode] || 
                parsed[name] || 
                parsed[code] ||
                parsed[langCode.toLowerCase()] ||
                parsed[name.toLowerCase()] ||
                (code ? parsed[code.toLowerCase()] : null) ||
                null;
            
            if (translation && typeof translation === 'string') {
                // Remove quotes if wrapped
                if ((translation.startsWith('"') && translation.endsWith('"')) || 
                    (translation.startsWith("'") && translation.endsWith("'"))) {
                    translation = translation.slice(1, -1);
                }
                
                // Restore preserved items
                translation = restorePreservedItems(translation, nameMap);
                
                // Remove unwanted notes
                translation = removeUnwantedNotes(translation);
                
                // Clean rogue placeholders if no original placeholders
                if (nameMap.size === 0) {
                    translation = translation.replace(/__PRESERVE_\d+_\d+__/g, '');
                    translation = translation.replace(/PRESERVE_\d+_\d+/g, '');
                    translation = translation.replace(/PRESERVE_X_X/g, '');
                }
                
                // Enforce emoji policy
                if (sourceHasEmoji) {
                    translation = filterEmojisToAllowed(translation, sourceEmojis);
                } else {
                    translation = stripEmojis(translation);
                }
                
                // Check for emoji-only response when source has text
                if (sourceHasNonEmojiText && stripEmojis(translation).trim().length === 0) {
                    console.warn(`⚠️ Emoji-only translation for ${langCode}, marking as null`);
                    translation = null;
                }
                
                // Anti-repetition check
                const repCheck = hasDegenerateRepetition(translation, normalizedText.length);
                if (repCheck.isDegenerate) {
                    translation = clampRepetitions(translation);
                }
                
                translations[langCode] = translation;
            } else {
                translations[langCode] = null;
            }
        }
        
        // Add back languages that matched source
        targetLanguages.forEach(lang => {
            if (lang === detected) {
                translations[lang] = text;
            }
        });
        
        console.log(`✅ [Translation] Batch success: 1 API call for ${languagesToTranslate.length} languages (saved ${languagesToTranslate.length - 1} calls, ${Math.round(((languagesToTranslate.length - 1) / languagesToTranslate.length) * 100)}% cost reduction)`);
        return translations;
        
    } catch (error) {
        console.warn(`⚠️ [Translation] Batch failed, falling back to individual calls:`, error?.message || error);
        
        // FALLBACK: Individual translations if batch fails
        let detected = sourceLanguage;
        try {
            if (!detected) {
                detected = await detectLanguage(text);
            }
        } catch (_) {
            detected = sourceLanguage;
        }
        
        await Promise.all(
            targetLanguages.map(async (targetLanguage) => {
                try {
                    translations[targetLanguage] = await translateText(
                        text,
                        targetLanguage,
                        detected,
                        useToneUnderstanding,
                        apiKey,
                        modelOverride
                    );
                } catch (error) {
                    console.error(`❌ Error translating to ${targetLanguage}:`, {
                        error: error?.message || error,
                        model: modelOverride || TRANSLATION_MODEL,
                        apiKeyPresent: !!apiKey,
                        targetLanguage,
                        sourceLanguage: detected,
                        textLength: text?.length || 0
                    });
                    translations[targetLanguage] = null;
                }
            })
        );
        
        // If all results still null/empty, try fallback model once
        const hasAny = Object.values(translations).some(v => typeof v === 'string' && v.length > 0);
        if (!hasAny) {
            const fallbackModel = 'mistral-small-latest';
            console.log(`⚠️ [Translation] Trying fallback model: ${fallbackModel}`);
            await Promise.all(
                targetLanguages.map(async (targetLanguage) => {
                    try {
                        translations[targetLanguage] = await translateText(
                            text,
                            targetLanguage,
                            detected,
                            useToneUnderstanding,
                            apiKey,
                            fallbackModel
                        );
                    } catch (error) {
                        console.error(`❌ Fallback error translating to ${targetLanguage}:`, error?.message || error);
                        translations[targetLanguage] = null;
                    }
                })
            );
        }
    }
    
    return translations;
};

/**
 * Analyzes an image to extract and translate any text content within it
 * @param {string} imageUrl - URL of the image to analyze
 * @param {string} targetLanguage - Target language for translation
 * @param {string} apiKey - Mistral API key to use
 * @returns {Promise<object>} - Object containing extracted text and translation
 */
const analyzeAndTranslateImage = async (imageUrl, targetLanguage, apiKey = MISTRAL_API_KEY) => {
    try {
        console.log(`🖼️ Extracting and translating text from image to ${targetLanguage}`);
        
        const response = await axiosMistral.post(
            'https://api.mistral.ai/v1/chat/completions',
            {
                model: 'mistral-small-latest', // Using Mistral Medium model for better vision capabilities
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `IMPORTANT: Look at this image and extract ALL text that appears in it. Focus ONLY on readable text content - signs, captions, labels, handwriting, printed text, etc.

Your task:
1. Carefully examine the image for ANY text content
2. Extract ALL readable text exactly as it appears
3. If you find text, detect its language and translate it to ${targetLanguage}
4. If no text is visible or readable, clearly indicate that

Respond ONLY in this exact JSON format:
{
  "hasText": true/false,
  "extractedText": "exact text found in the image (empty string if no text)",
  "detectedLanguage": "language code of the extracted text (empty if no text)",
  "translation": "translation of the extracted text to ${targetLanguage} (empty if no text)",
  "confidence": "high/medium/low"
}

CRITICAL RULES:
- If you see ANY text in the image, set hasText to true
- Extract text EXACTLY as written, including punctuation and formatting
- Do NOT describe the image - ONLY extract text content
- Do NOT add explanations or descriptions
- If no text is visible, set hasText to false and leave other fields empty
- Be thorough - check all parts of the image for text`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: imageUrl
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.1 // Low temperature for precise text extraction
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const result = response.data.choices[0].message.content;
        console.log('🔍 Mistral vision response:', result);

        // Try to parse JSON response
        try {
            // Clean the result string - remove markdown code blocks if present
            let cleanResult = result.trim();
            
            if (cleanResult.startsWith('```json')) {
                cleanResult = cleanResult.replace(/```json\n?/, '').replace(/\n?```$/, '');
            } else if (cleanResult.startsWith('```')) {
                cleanResult = cleanResult.replace(/```\n?/, '').replace(/\n?```$/, '');
            }
            
            const parsedResult = JSON.parse(cleanResult);
            console.log('✅ Successfully parsed vision response:', parsedResult);
            
            // Validate the response structure
            if (typeof parsedResult.hasText === 'boolean') {
                // If no text was found, return appropriate response
                if (!parsedResult.hasText || !parsedResult.extractedText || parsedResult.extractedText.trim() === '') {
                    console.log('ℹ️ No text found in image');
                    return {
                        hasText: false,
                        extractedText: '',
                        detectedLanguage: '',
                        translation: '',
                        confidence: 'high'
                    };
                }
                
                // If text was found, ensure we have a translation
                let finalTranslation = parsedResult.translation;
                if (!finalTranslation || finalTranslation.trim() === '') {
                    // If no translation provided, translate the extracted text
                    const detectedLang = parsedResult.detectedLanguage || await detectLanguage(parsedResult.extractedText);
                    if (detectedLang.toLowerCase() !== targetLanguage.toLowerCase()) {
                        finalTranslation = await translateText(parsedResult.extractedText, targetLanguage, detectedLang);
                    } else {
                        finalTranslation = parsedResult.extractedText;
                    }
                }
                
                return {
                    hasText: true,
                    extractedText: parsedResult.extractedText,
                    detectedLanguage: parsedResult.detectedLanguage || 'unknown',
                    translation: finalTranslation,
                    confidence: parsedResult.confidence || 'medium'
                };
            } else {
                throw new Error('Invalid response structure - missing hasText field');
            }
            
        } catch (parseError) {
            console.log('⚠️ Could not parse JSON response, attempting fallback analysis');
            console.log('Raw response:', result);
            
            // Fallback: if the response contains text but isn't JSON, try to extract it
            if (result && result.trim().length > 0 && !result.toLowerCase().includes('no text') && !result.toLowerCase().includes('cannot see')) {
                const detectedLang = await detectLanguage(result);
                let translation = result;
                
                if (detectedLang.toLowerCase() !== targetLanguage.toLowerCase()) {
                    translation = await translateText(result, targetLanguage, detectedLang);
                }
                
                return {
                    hasText: true,
                    extractedText: result,
                    detectedLanguage: detectedLang,
                    translation: translation,
                    confidence: 'low'
                };
            } else {
                // No usable text found
                return {
                    hasText: false,
                    extractedText: '',
                    detectedLanguage: '',
                    translation: '',
                    confidence: 'medium'
                };
            }
        }

    } catch (error) {
        console.error('❌ Error analyzing image:', error.response?.data || error.message);
        
        // If it's a rate limit error, throw a specific error
        if (error.response?.status === 429) {
            throw new Error('RATE_LIMITED');
        }
        
        // Log more details for debugging
        if (error.response?.data) {
            console.error('API Error Details:', JSON.stringify(error.response.data, null, 2));
        }
        
        throw new Error('Image analysis failed');
    }
};

module.exports = {
    translateText,
    detectLanguage,
    translateTextToMultipleLanguages,
    analyzeAndTranslateImage
};