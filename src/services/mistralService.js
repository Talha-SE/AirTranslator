const axios = require('axios');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

    return analysis;
};

/**
 * Helper to POST to Mistral with automatic retries on 429 or network errors.
 * @param {object} payload - JSON body for chat/completions
 * @param {number} maxRetries - maximum retry attempts
 * @param {string} [apiKey] - Optional custom API key
 */
const postMistralWithRetry = async (payload, maxRetries = 5, apiKey = MISTRAL_API_KEY) => {
    let attempt = 0;
    while (true) {
        try {
            return await axios.post(mistralAPIUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (err) {
            const status = err.response?.status;
            // Retry only on 429 or network errors
            if (attempt >= maxRetries || (status && status !== 429)) {
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
            const backoff = Math.min(60000, Math.max(retryAfterMs, expBackoff));
            console.warn(`Mistral request failed (status ${status}). Retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(backoff);
            attempt++;
        }
    }
};

const { MISTRAL_API_KEY, AUTO_DETECT_LANGUAGE } = require('../utils/constants');

const mistralAPIUrl = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Detects the language of a given text
 * @param {string} text - The text to detect the language for
 * @returns {string} - The detected language code
 */
const detectLanguage = async (text) => {
    try {
        // Normalize the text before detection
        const normalizedText = normalizeElongatedText(text);
        
        const response = await postMistralWithRetry({
            model: 'mistral-small-latest',
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
            temperature: 0.1,
            max_tokens: 10
        });

        let langCode = response.data.choices[0].message.content.trim().toLowerCase();
        
        // Clean up the language code (remove quotes, punctuation, etc.)
        langCode = langCode.replace(/[^\w]/g, '');
        
        return langCode;
    } catch (error) {
        console.error('Error detecting language:', error);
        return 'en'; // Default to English if detection fails
    }
};

const translateText = async (text, targetLanguage, sourceLanguage = null, useToneUnderstanding = false, apiKey = MISTRAL_API_KEY) => {
    try {
        // If target language is "auto", we don't need to translate
        if (targetLanguage === AUTO_DETECT_LANGUAGE) {
            return text;
        }

        // Normalize elongated text before translation
        const normalizedText = normalizeElongatedText(text);

        // If no source language is provided and target isn't auto, detect the language
        if (!sourceLanguage && targetLanguage !== AUTO_DETECT_LANGUAGE) {
            sourceLanguage = await detectLanguage(normalizedText);
        }

        // If the detected source language is the same as the target, no translation needed
        if (sourceLanguage && sourceLanguage === targetLanguage) {
            return text;
        }

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

            // Translate each chunk individually and concatenate the results
            const translatedChunks = [];
            
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
            
            // Translate each processed chunk
            for (const chunk of processedChunks) {
                // Recursive call but with shorter text (won't trigger chunking again)
                const translatedChunk = await translateText(chunk, targetLanguage, sourceLanguage, useToneUnderstanding, apiKey);
                translatedChunks.push(translatedChunk);
            }
            
            // Restore preserved items in the final result
            const finalTranslation = translatedChunks.join('');
            return restorePreservedItems(finalTranslation, nameMap);
        }

        // Create appropriate system prompt based on tone understanding setting
        let systemContent = `You are a professional translator. Translate text accurately and naturally as user intented while preserving meaning and style. Give complete translation.

CRITICAL TRANSLATION RULES - FOLLOW EXACTLY:
- TRANSLATE ONLY THE INPUT TEXT - do not add, expand, or create additional content
- NEVER add any notes, explanations, disclaimers, comments, or parenthetical remarks
- NEVER write anything like "(Note: ...)", "(Translation: ...)", or "(The original...)"
- NEVER explain ambiguities, difficulties, or interpretation choices
- NEVER add context about the source language, translation process, or methodology
- NEVER justify translation choices or mention alternative interpretations
- NEVER create conversations, dialogues, or additional sentences not in the original
- NEVER expand single words into full sentences or conversations
- For elongated words (like "heyyyyy"), translate to equivalent casual form in target language
- If target language doesn't use elongation, keep meaning but remove repetitions
- Preserve every emoji exactly as written (😊 stays 😊, ❤️ stays ❤️)
- Never translate emoji meanings
- Maintain original emoji positions
- Preserve all line breaks and spacing exactly
- Preserve punctuation and special characters
- Preserve the author's exact voice and style
- Prioritize accuracy in conveying the author's exact meaning. Maintain the original tone, formality level, and writing style.
- Your translation should read as if the original author wrote it directly in the target language. Preserve nuance, idioms, and cultural context appropriately.
- Focus on delivering translations that capture not just what was said, but how it was said - including humor, emotion, and subtle implications.

KOREAN TRANSLATION ACCURACY RULES:
- 나 = I/me (NOT "you")
- 저 = I/me (formal, NOT "you") 
- 너 = you (informal)
- 당신 = you (formal)
- 우리 = we/us (NOT "I")
- Pay special attention to Korean pronouns - they are often mistranslated
- Korean sentence structure: Subject-Object-Verb order, translate meaning correctly
- Consider Korean honorific levels (반말/존댓말) in context

TRANSLITERATION RULES:
- For proper names (people, places, brands), transliterate them into the target language's writing system
- Example: "John" becomes "جون" in Arabic, "ジョン" in Japanese, "约翰" in Chinese
- Example: "McDonald's" becomes "ماكدونالدز" in Arabic, "マクドナルド" in Japanese
- Do NOT translate the meaning of names, only convert the sound/pronunciation
- Keep the same pronunciation but write it in target language script

If input appears meaningless:
- Convert letter-by-letter to target language sounds
- Never comment on the input
- Never add disclaimers

FINAL RULE: Return ONLY the translated text. Nothing else. No explanations whatsoever.`;

        if (useToneUnderstanding) {
            systemContent = `You are an expert cultural translator with advanced emotional intelligence. Your role is to perfectly preserve the author's intent, emotional state, formality level, and cultural context while adapting the message naturally to the target language.

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
  * Korean: "babyyy" → "베이비이이" or "자기야야야", "heyyyy" → "야야야" or "안녕히히히"
  * Japanese: "babyyy" → "ベイビーー" or "赤ちゃ〜ん", add ー or 〜 for elongation
  * Spanish: "babyyy" → "bebééé" or "amorrrr", use accent repetition
  * French: "babyyy" → "bébééé" or "chériiii", repeat final vowels
  * Arabic: Add ـ (tatweel) or repeat final letters for emphasis
- TILDE CUTENESS: For expressions like "babyyy~~~", "cute~~~" - preserve the extra cuteness
  * Korean: "babyyy~~~" → "베이비이이~~♡" or "자기야야야~~~ㅎㅎ" or "애기야야~~~ㅋㅋ"
  * Japanese: "babyyy~~~" → "ベイビー〜〜〜" or "かわいい〜〜"
  * Spanish: "babyyy~~~" → "bebé~~~" or "lindo~~~"
  * All languages: Tildes (~~~) indicate extreme cuteness/playfulness - amplify the affectionate tone

CONTEXTUAL AWARENESS:
- RELATIONSHIP DYNAMICS: Consider speaker-listener relationship (boss-employee, friends, strangers, romantic partners)
- EMOTIONAL SUBTEXT: Detect underlying emotions (passive-aggressive, nervous, confident, flirty, caring)
- SITUATIONAL CONTEXT: Adapt to context (celebration, complaint, question, announcement, greeting, affection)
- PERSONALITY MARKERS: Preserve individual speech patterns and personality quirks
- INTIMACY INDICATORS: Terms like "baby", "babe", "honey", "love" indicate close/romantic relationship - translate with appropriate intimacy level
- CASUAL GREETINGS: "hey" with elongation ("heyyyy") shows familiarity - use casual greeting forms in target language

CRITICAL TECHNICAL RULES - FOLLOW EXACTLY:
- TRANSLATE ONLY THE INPUT TEXT - do not add, expand, or create additional content
- NEVER add any notes, explanations, disclaimers, comments, or parenthetical remarks
- NEVER write anything like "(Note: ...)", "(Translation: ...)", or "(The original...)"
- NEVER explain ambiguities, difficulties, or interpretation choices
- NEVER add context about the source language, translation process, or methodology
- NEVER justify translation choices or mention alternative interpretations
- NEVER create conversations, dialogues, or additional sentences not in the original
- NEVER expand single words into full sentences or conversations
- For elongated words (like "heyyyyy", "babyyy", "loveeee"), translate to equivalent casual form with appropriate elongation in target language
- If target language doesn't use elongation, use other casual markers (repeated punctuation, casual particles)
- CRITICAL KOREAN HANDLING: "hey" + casual/affectionate tone should become "야" or "이봐" + appropriate particles
- KOREAN AFFECTIONATE ELONGATION: "babyyy" → "베이비이이~~♡" or "자기야야야~~~ㅎㅎ" or "애기야야~~~ㅋㅋ"
- KOREAN MANDATORY CHATTING STYLE: Always add Korean chat elements (~~~, ㅋㅋ, ♡) when translating casual/affectionate elongated text
- KOREAN ELONGATED GREETINGS: "heyyyy" → "야야야~~~" or "어이이이~~ㅋㅋ" (NEVER just "야")
- FOR TONE UNDERSTANDING: Korean translations MUST include cute chatting elements for elongated affectionate expressions
- Preserve every emoji exactly as written (😊 stays 😊, ❤️ stays ❤️)
- Never translate emoji meanings
- Maintain original emoji positions
- Preserve all line breaks and spacing exactly
- Preserve punctuation intensity (!! stays !!, ... stays ...)

LANGUAGE-SPECIFIC EXPERTISE:
KOREAN:
- 나 = I/me (NOT "you"), 저 = I/me (formal), 너 = you (informal), 당신 = you (formal), 우리 = we/us
- Match honorific levels perfectly (반말/존댓말) based on relationship and formality
- Use appropriate particles (야/아, 이야/야) for casual tone
- Preserve emotional particles (네, 어, 지) that convey speaker's feelings
- For casual/affectionate tone: Use 야, 아, 애 endings and casual particles
- For elongated casual expressions: Use ㅇ or vowel repetition (아아아, 야야야, 우우우)
- Affectionate terms: 자기야 (honey), 베이비 (baby), 애기야 (baby), 사랑아 (love)
- Casual emphasis: Add ㅋㅋ for laughter, ㅎㅎ for soft laughter, ㅠㅠ for crying
- Preserve playful elongation: "babyyy" → "베이비이이" or "자기야야야"
- ELONGATION EXAMPLES: "heyyyyyy" → "야야야야야" or "어이이이이", "babyyyyy" → "베이비이이이이" or "자기야야야야"
- KOREAN CHATTING STYLE: Add cute elements like ~, ㅋㅋㅋ, ♡, ㅎㅎㅎ
- KOREAN ELONGATED CHATTING: "heyyyyyy" → "야야야야~~~" or "어이이이이~~ㅋㅋ" or "안뇽~~~"
- KOREAN CUTE PATTERNS: Use ~~, ♡, ㅋㅋ, ㅎㅎ, ㅠㅠ, >< for extra cuteness
- KOREAN AFFECTIONATE CHATTING: "babyyy~~~" → "베이비이이~~♡" or "자기야야야~~~ㅎㅎ"

JAPANESE:
- Match keigo (honorific) levels precisely
- Use appropriate sentence endings for gender and relationship (だ/である vs です/ます)
- Preserve emotional particles (ね, よ, な) that indicate speaker's intent
- ELONGATION TECHNIQUE: Use ー (chōonpu) or 〜 (tilde) for extending sounds
- ELONGATION EXAMPLES: "heyyyy" → "おーい" or "ねー", "babyyy" → "ベイビーー" or "赤ちゃーん"

ARABIC:
- Adapt between formal Modern Standard Arabic and dialectical expressions based on tone
- Preserve emotional intensity through appropriate verb forms and expressions
- Use cultural greetings and closings that match the relationship level
- ELONGATION TECHNIQUE: Use tatweel (ـ) to extend letters or repeat final consonants/vowels
- ELONGATION EXAMPLES: "heyyyy" → "هـــاي" or "أهـــلا", "babyyy" → "حبيبـــي" or "عزيـــزي"

SPANISH:
- Distinguish between tú/usted based on formality and relationship
- Preserve regional emotional expressions and cultural markers
- Match intensity through appropriate diminutives and augmentatives
- ELONGATION TECHNIQUE: Repeat vowels with accents or extend final sounds
- ELONGATION EXAMPLES: "heyyyy" → "hoooolaaaa" or "eyyy", "babyyy" → "bebééé" or "amorrrr"

CHINESE:
- Use appropriate measure words and particles that convey politeness level
- Preserve emotional tone through particle usage (啊, 呢, 吧)
- Adapt between formal and colloquial expressions based on context
- ELONGATION TECHNIQUE: Repeat characters or use particle repetition
- ELONGATION EXAMPLES: "heyyyy" → "嗨嗨嗨嗨" or "哎呀呀呀", "babyyy" → "亲爱的的的" or "宝贝贝贝"

FRENCH:
- Match vous/tu usage based on relationship formality
- Preserve emotional undertones through appropriate subjunctive and conditional usage
- Use cultural expressions that carry equivalent emotional weight
- ELONGATION TECHNIQUE: Repeat final vowels or use accent marks
- ELONGATION EXAMPLES: "heyyyy" → "salutttt" or "coucouuuu", "babyyy" → "bébééé" or "chériiii"

TRANSLITERATION RULES:
- For proper names (people, places, brands), transliterate them into the target language's writing system
- Example: "John" becomes "جون" in Arabic, "ジョン" in Japanese, "约翰" in Chinese
- Example: "McDonald's" becomes "ماكدونالدز" in Arabic, "マクドナルド" in Japanese
- Do NOT translate the meaning of names, only convert the sound/pronunciation
- Keep the same pronunciation but write it in target language script

FINAL RULE: Return ONLY the translated text with perfect tone preservation. Nothing else. No explanations whatsoever.`;

        }

        // Add contextual tone analysis for enhanced understanding when tone mode is enabled
        let toneContextPrompt = '';
        if (useToneUnderstanding) {
            const toneAnalysis = analyzeToneContext(normalizedText);
            
            const contextParts = [];
            
            if (toneAnalysis.emotions.length > 0) {
                contextParts.push(`Emotions detected: ${toneAnalysis.emotions.join(', ')}`);
            }
            
            if (toneAnalysis.formality !== 'neutral') {
                contextParts.push(`Formality level: ${toneAnalysis.formality}`);
            }
            
            if (toneAnalysis.intensity !== 'medium') {
                contextParts.push(`Message intensity: ${toneAnalysis.intensity}`);
            }
            
            if (toneAnalysis.features.length > 0) {
                const featureDescriptions = {
                    'elongation': 'text has elongated words (showing emphasis/emotion)',
                    'affectionate_elongation': 'contains elongated affectionate terms like "babyyy", "heyyyy" (preserve playful intimacy)',
                    'extreme_elongation': 'contains heavily elongated words like "heyyyyyyyy", "babyyyyy" (use language-specific elongation techniques)',
                    'emojis': 'contains emojis (preserve their emotional context)',
                    'ellipsis': 'uses ellipsis (indicating pause, uncertainty, or continuation)',
                    'emphasis': 'uses multiple exclamation marks (high emotional emphasis)',
                    'mentions': 'contains @mentions (preserve exactly)',
                    'hashtags': 'contains #hashtags (preserve exactly)',
                    'caps': 'uses CAPS for emphasis (preserve intensity)',
                    'multiple_questions': 'uses multiple question marks (showing confusion/urgency)',
                    'tildes': 'uses tildes ~~~ for playful/cute tone (preserve cuteness)',
                    'affectionate_tildes': 'combines affectionate terms with tildes like "babyyy~~~" (extra cute/playful tone)',
                    'korean_chatting': 'uses Korean chat symbols like ㅋㅋ, ㅎㅎ, ㅠㅠ, ♡, >< (preserve Korean texting style)',
                    'asterisk_emphasis': 'uses *asterisks* for emphasis',
                    'laughter': 'contains laughter expressions (preserve humor)',
                    'hyphenated_words': 'uses hyphenated expressions',
                    'text_numbers': 'mixes numbers with text (preserve style)'
                };
                
                const featureDetails = toneAnalysis.features
                    .map(feature => featureDescriptions[feature] || feature)
                    .join('; ');
                contextParts.push(`Special features: ${featureDetails}`);
            }
            
            if (contextParts.length > 0) {
                toneContextPrompt = `\n\nIMPORTANT CONTEXT FOR THIS SPECIFIC MESSAGE: ${contextParts.join('. ')}. Use this context to ensure your translation perfectly captures these nuances in the target language's cultural and linguistic patterns.`;
                
                // Add specific elongation instructions if elongation is detected
                if (toneAnalysis.features.includes('elongation') || toneAnalysis.features.includes('affectionate_elongation') || toneAnalysis.features.includes('extreme_elongation')) {
                    toneContextPrompt += `\n\nELONGATION TRANSLATION GUIDE:
- Korean: Use vowel/consonant repetition + chatting elements (야야야야~~~, 베이비이이이~~ㅋㅋ, 어이이이이~~~♡)
- Japanese: Use ー for long vowels (ベイビーーー, おーーい) or 〜 for casual tone
- Spanish: Repeat vowels with intensity (hoooolaaaa, bebééééé, amorrrrrr)
- French: Repeat final vowels (salutttttt, chériiiiii, coucouuuuu)  
- Arabic: Use tatweel ـ to extend (هــــاي, حبيبـــــي) or repeat letters
- Chinese: Repeat characters (嗨嗨嗨嗨, 宝贝贝贝贝) or particles (啊啊啊啊)
CRITICAL: Match the LENGTH of elongation from original text!`;
                }
                
                // Add specific tilde instructions if tildes are detected
                if (toneAnalysis.features.includes('tildes') || toneAnalysis.features.includes('affectionate_tildes')) {
                    toneContextPrompt += `\n\nTILDE CUTENESS GUIDE:
- Korean: Add cute chatting elements (야야야~~~, 베이비이이~~ㅋㅋ, 안뇽~~~♡, 자기야야~~~ㅎㅎ)
- Japanese: Use 〜 naturally (ベイビー〜〜, かわいい〜〜〜)
- Spanish: Keep tildes or use cute endings (bebé~~~, lindooo~~~)
- French: Add cute expressions (bébé~~~, mignon~~~)
- Arabic: Use decorative marks or sweet expressions (حبيبي~~~, يا قمر~~~)
- Chinese: Add cute particles (宝贝~~~, 可爱~~~)
PRESERVE the playful, cute, affectionate feeling of tildes!`;
                }

                // Add specific Korean chatting instructions if Korean chatting elements are detected OR if elongation + affection is detected
                if (toneAnalysis.features.includes('korean_chatting') || 
                    (toneAnalysis.features.includes('affectionate_elongation') && toneAnalysis.emotions.includes('affectionate'))) {
                    toneContextPrompt += `\n\nKOREAN CHATTING STYLE MANDATORY:
For Korean translations, you MUST add cute chatting elements:
- "hey babyyy" → "야야야 베이비이이~~~♡" or "어이이 자기야야~~ㅎㅎ" 
- Add ~~~, ㅋㅋ, ㅎㅎ, ♡, or >< to show cuteness
- Never translate elongated affectionate terms to plain Korean without chat elements
- Example: WRONG: "야 자기야야" → CORRECT: "야야야~~~ 베이비이이♡" or "어이이 자기야야~~~ㅎㅎ"`;
                }
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

        // Prepare system content without placeholder instructions if no placeholders are needed
        let finalSystemContent = systemContent + toneContextPrompt;
        if (nameMap.size > 0) {
            finalSystemContent += '\n\nCRITICAL: You will see placeholder text that looks like "__PRESERVE_0_1__" or "__PRESERVE_1_2__" etc. These are special markers for technical content. Keep these placeholders EXACTLY as they appear - do not modify the numbers, underscores, or any part of them. Do not create your own placeholders.';
        } else {
            finalSystemContent += '\n\nIMPORTANT: Do not create any placeholder text or markers. Translate the text directly and naturally.';
        }

        const response = await postMistralWithRetry({
            model: 'mistral-small-latest',
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
            temperature: 0.1,  // Lower temperature for more precise, less creative translations
            // Dynamically set max_tokens but cap it to avoid hitting hard limits
            max_tokens: Math.min(4096, Math.max(400, Math.ceil(normalizedText.length * 1.2))) // Allow sufficient tokens while preventing truncation
        }, apiKey);

        let translation = response.data.choices[0].message.content.trim();
        
        // Remove quotes if they exist around the translation
        if ((translation.startsWith('"') && translation.endsWith('"')) || 
            (translation.startsWith("'") && translation.endsWith("'"))) {
            translation = translation.slice(1, -1);
        }
        
        // Remove any explanatory notes or comments that might have slipped through
        translation = removeUnwantedNotes(translation);
        
        // Restore the preserved technical items (URLs, mentions, etc.)
        translation = restorePreservedItems(translation, nameMap);
        
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
        
        // Keep full translation lines
        return translation;
    } catch (error) {
        console.error('Error translating text:', error);
        throw new Error('Translation failed');
    }
};

const translateTextToMultipleLanguages = async (text, targetLanguages, sourceLanguage = null, useToneUnderstanding = false, apiKey = MISTRAL_API_KEY) => {
    const translations = {};
    let detected = sourceLanguage;
    try {
        if (!detected) {
            detected = await detectLanguage(text);
        }
    } catch (_) {
        // Fallback to null if detection fails; translateText will handle auto-detect
        detected = sourceLanguage;
    }
    for (const targetLanguage of targetLanguages) {
        translations[targetLanguage] = await translateText(
            text,
            targetLanguage,
            detected,
            useToneUnderstanding,
            apiKey
        );
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
        
        const response = await axios.post(
            'https://api.mistral.ai/v1/chat/completions',
            {
                model: 'mistral-medium-latest', // Using Mistral Medium model for better vision capabilities
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