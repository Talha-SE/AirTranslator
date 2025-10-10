// Helper to validate max two languages and map to speaker assignment
// Languages are compared in lowercase to match existing pipeline usage.

const SUPPORTED_LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian', 'japanese', 'korean', 'chinese',
  'hindi', 'arabic', 'turkish', 'polish', 'dutch', 'swedish', 'norwegian', 'finnish', 'danish', 'thai', 'vietnamese',
  'indonesian', 'urdu', 'bengali', 'greek', 'czech', 'slovak', 'romanian', 'hungarian', 'ukrainian', 'hebrew', 'persian'
]);

const DEFAULT_VOICE_BY_LANGUAGE = {
  // Map to Mimic3 voices; use env overrides if provided
  english: { voice: process.env.MIMIC3_VOICE_EN || process.env.MIMIC3_DEFAULT_VOICE || 'en_US/amy-medium' },
  korean: { voice: process.env.MIMIC3_VOICE_KO || 'en_US/amy-medium' }, // Fallback to English if Korean not available
  spanish: { voice: process.env.MIMIC3_VOICE_ES || 'en_US/ljspeech-medium' },
  french: { voice: process.env.MIMIC3_VOICE_FR || 'en_US/ljspeech-medium' },
  german: { voice: process.env.MIMIC3_VOICE_DE || 'en_US/ljspeech-medium' },
  italian: { voice: process.env.MIMIC3_VOICE_IT || 'en_US/ljspeech-medium' },
  portuguese: { voice: process.env.MIMIC3_VOICE_PT || 'en_US/ljspeech-medium' },
  russian: { voice: process.env.MIMIC3_VOICE_RU || 'en_US/ljspeech-medium' },
  japanese: { voice: process.env.MIMIC3_VOICE_JA || 'en_US/ljspeech-medium' },
  chinese: { voice: process.env.MIMIC3_VOICE_ZH || 'en_US/ljspeech-medium' },
};

function normalizeLanguages(langs) {
  if (!Array.isArray(langs)) return [];
  return [...new Set(langs.map(l => String(l).trim().toLowerCase()).filter(Boolean))];
}

function validateLanguages(langs) {
  const normalized = normalizeLanguages(langs);
  if (normalized.length === 0) return { ok: false, error: 'Please specify at least one language.' };
  if (normalized.length > 2) return { ok: false, error: 'A maximum of 2 languages can be spoken.' };
  for (const l of normalized) {
    if (!SUPPORTED_LANGUAGES.has(l)) return { ok: false, error: `Unsupported language: ${l}` };
  }
  return { ok: true, languages: normalized };
}

function assignVoices(languages, customVoices) {
  const [l1, l2] = languages;
  const defaultVoice = process.env.MIMIC3_DEFAULT_VOICE || process.env.MIMIC3_VOICE_EN || 'en_US/amy-medium';
  const v1 = customVoices?.primary || DEFAULT_VOICE_BY_LANGUAGE[l1]?.voice || defaultVoice;
  const v2 = l2 ? (customVoices?.secondary || DEFAULT_VOICE_BY_LANGUAGE[l2]?.voice || defaultVoice) : undefined;
  return { voice1: v1, voice2: v2 };
}

module.exports = {
  SUPPORTED_LANGUAGES,
  normalizeLanguages,
  validateLanguages,
  assignVoices,
};
