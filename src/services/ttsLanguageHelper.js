// Helper to validate max two languages and map to speaker assignment
// Languages are compared in lowercase to match existing pipeline usage.

const SUPPORTED_LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian', 'japanese', 'korean', 'chinese',
  'hindi', 'arabic', 'turkish', 'polish', 'dutch', 'swedish', 'norwegian', 'finnish', 'danish', 'thai', 'vietnamese',
  'indonesian', 'urdu', 'bengali', 'greek', 'czech', 'slovak', 'romanian', 'hungarian', 'ukrainian', 'hebrew', 'persian'
]);

const DEFAULT_VOICE_BY_LANGUAGE = {
  // Native language voices from Mimic3 voice catalog
  english: { voice: process.env.MIMIC3_VOICE_EN || 'en_US/ljspeech_low' },
  spanish: { voice: process.env.MIMIC3_VOICE_ES || 'es_ES/carlfm_low' },
  french: { voice: process.env.MIMIC3_VOICE_FR || 'fr_FR/siwis_low' },
  german: { voice: process.env.MIMIC3_VOICE_DE || 'de_DE/thorsten_low' },
  italian: { voice: process.env.MIMIC3_VOICE_IT || 'it_IT/riccardo-fasol_low' },
  portuguese: { voice: process.env.MIMIC3_VOICE_PT || 'es_ES/carlfm_low' }, // Use Spanish as closest
  russian: { voice: process.env.MIMIC3_VOICE_RU || 'ru_RU/multi_low' },
  dutch: { voice: process.env.MIMIC3_VOICE_NL || 'nl/bart-de-leeuw_low' },
  polish: { voice: process.env.MIMIC3_VOICE_PL || 'pl_PL/m-ailabs_low' },
  ukrainian: { voice: process.env.MIMIC3_VOICE_UK || 'uk_UK/m-ailabs_low' },
  finnish: { voice: process.env.MIMIC3_VOICE_FI || 'fi_FI/harri-tapani-ylilammi_low' },
  hungarian: { voice: process.env.MIMIC3_VOICE_HU || 'hu_HU/diana-majlinger_low' },
  greek: { voice: process.env.MIMIC3_VOICE_EL || 'el_GR/rapunzelina_low' },
  vietnamese: { voice: process.env.MIMIC3_VOICE_VI || 'vi_VN/vais1000_low' },
  korean: { voice: process.env.MIMIC3_VOICE_KO || 'ko_KO/kss_low' },
  japanese: { voice: process.env.MIMIC3_VOICE_JA || 'en_US/ljspeech_low' }, // Fallback to English
  chinese: { voice: process.env.MIMIC3_VOICE_ZH || 'en_US/ljspeech_low' }, // Fallback to English
  hindi: { voice: process.env.MIMIC3_VOICE_HI || 'en_US/ljspeech_low' }, // Fallback to English
  arabic: { voice: process.env.MIMIC3_VOICE_AR || 'en_US/ljspeech_low' }, // Fallback to English
  turkish: { voice: process.env.MIMIC3_VOICE_TR || 'en_US/ljspeech_low' }, // Fallback to English
  swedish: { voice: process.env.MIMIC3_VOICE_SV || 'en_US/ljspeech_low' }, // Fallback to English
  norwegian: { voice: process.env.MIMIC3_VOICE_NO || 'en_US/ljspeech_low' }, // Fallback to English
  danish: { voice: process.env.MIMIC3_VOICE_DA || 'en_US/ljspeech_low' }, // Fallback to English
  thai: { voice: process.env.MIMIC3_VOICE_TH || 'en_US/ljspeech_low' }, // Fallback to English
  indonesian: { voice: process.env.MIMIC3_VOICE_ID || 'jv_ID/google-gmu_low' }, // Use Javanese as closest
  urdu: { voice: process.env.MIMIC3_VOICE_UR || 'en_US/ljspeech_low' }, // Fallback to English
  bengali: { voice: process.env.MIMIC3_VOICE_BN || 'bn/multi_low' },
  czech: { voice: process.env.MIMIC3_VOICE_CS || 'en_US/ljspeech_low' }, // Fallback to English
  slovak: { voice: process.env.MIMIC3_VOICE_SK || 'en_US/ljspeech_low' }, // Fallback to English
  romanian: { voice: process.env.MIMIC3_VOICE_RO || 'en_US/ljspeech_low' }, // Fallback to English
  hebrew: { voice: process.env.MIMIC3_VOICE_HE || 'en_US/ljspeech_low' }, // Fallback to English
  persian: { voice: process.env.MIMIC3_VOICE_FA || 'fa/haaniye_low' },
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

// Alternative high-quality voices for variety
const ALTERNATIVE_VOICES = {
  english: ['en_US/ljspeech_low', 'en_US/m-ailabs_low', 'en_US/hifi-tts_low', 'en_UK/apope_low'],
  spanish: ['es_ES/carlfm_low', 'es_ES/m-ailabs_low'],
  french: ['fr_FR/siwis_low', 'fr_FR/m-ailabs_low', 'fr_FR/tom_low'],
  german: ['de_DE/thorsten_low', 'de_DE/thorsten-emotion_low', 'de_DE/m-ailabs_low'],
  italian: ['it_IT/riccardo-fasol_low', 'it_IT/mls_low'],
  dutch: ['nl/bart-de-leeuw_low', 'nl/flemishguy_low', 'nl/nathalie_low', 'nl/pmk_low', 'nl/rdh_low'],
  russian: ['ru_RU/multi_low'],
  korean: ['ko_KO/kss_low'],
  vietnamese: ['vi_VN/vais1000_low'],
  persian: ['fa/haaniye_low'],
  bengali: ['bn/multi_low'],
};

function assignVoices(languages, customVoices) {
  const [l1, l2] = languages;
  const defaultVoice = process.env.MIMIC3_DEFAULT_VOICE || 'en_US/ljspeech_low';
  
  // Get best voice for each language
  const v1 = customVoices?.primary || DEFAULT_VOICE_BY_LANGUAGE[l1]?.voice || defaultVoice;
  const v2 = l2 ? (customVoices?.secondary || DEFAULT_VOICE_BY_LANGUAGE[l2]?.voice || defaultVoice) : undefined;
  
  return { voice1: v1, voice2: v2 };
}

function getBestVoiceForLanguage(language) {
  return DEFAULT_VOICE_BY_LANGUAGE[language?.toLowerCase()]?.voice || 'en_US/ljspeech_low';
}

function getAlternativeVoices(language) {
  return ALTERNATIVE_VOICES[language?.toLowerCase()] || ['en_US/ljspeech_low'];
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_VOICE_BY_LANGUAGE,
  ALTERNATIVE_VOICES,
  normalizeLanguages,
  validateLanguages,
  assignVoices,
  getBestVoiceForLanguage,
  getAlternativeVoices,
};
