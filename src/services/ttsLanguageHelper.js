// Helper to validate max two languages and map to speaker assignment
// Languages are compared in lowercase to match existing pipeline usage.

const SUPPORTED_LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian', 'japanese', 'korean', 'chinese',
  'hindi', 'arabic', 'turkish', 'polish', 'dutch', 'swedish', 'norwegian', 'finnish', 'danish', 'thai', 'vietnamese',
  'indonesian', 'urdu', 'bengali', 'greek', 'czech', 'slovak', 'romanian', 'hungarian', 'ukrainian', 'hebrew', 'persian'
]);

const DEFAULT_VOICE_BY_LANGUAGE = {
  english: { voice: 'Zephyr' },
  spanish: { voice: 'Puck' },
  french: { voice: 'Zephyr' },
  german: { voice: 'Puck' },
  italian: { voice: 'Zephyr' },
  portuguese: { voice: 'Puck' },
  russian: { voice: 'Zephyr' },
  japanese: { voice: 'Puck' },
  korean: { voice: 'Zephyr' },
  chinese: { voice: 'Puck' },
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
  const v1 = customVoices?.primary || DEFAULT_VOICE_BY_LANGUAGE[l1]?.voice || 'Zephyr';
  const v2 = l2 ? (customVoices?.secondary || DEFAULT_VOICE_BY_LANGUAGE[l2]?.voice || 'Puck') : undefined;
  return { voice1: v1, voice2: v2 };
}

module.exports = {
  SUPPORTED_LANGUAGES,
  normalizeLanguages,
  validateLanguages,
  assignVoices,
};
