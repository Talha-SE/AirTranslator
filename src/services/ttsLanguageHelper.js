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
  korean: { voice: process.env.MIMIC3_VOICE_KO || 'ko_KR/kss' },
  // Other languages can fall back; these entries are placeholders and will be ignored by Mimic3 picker
  spanish: { voice: 'en_US/amy-medium' },
  french: { voice: 'en_US/amy-medium' },
  german: { voice: 'en_US/amy-medium' },
  italian: { voice: 'en_US/amy-medium' },
  portuguese: { voice: 'en_US/amy-medium' },
  russian: { voice: 'en_US/amy-medium' },
  japanese: { voice: 'en_US/amy-medium' },
  chinese: { voice: 'en_US/amy-medium' },
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
