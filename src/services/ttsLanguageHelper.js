// Helper to validate max two languages and map to speaker assignment
// Languages are compared in lowercase to match existing pipeline usage.

const SUPPORTED_LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian', 'japanese', 'korean', 'chinese',
  'hindi', 'arabic', 'turkish', 'polish', 'dutch', 'swedish', 'norwegian', 'finnish', 'danish', 'thai', 'vietnamese',
  'indonesian', 'urdu', 'bengali', 'greek', 'czech', 'slovak', 'romanian', 'hungarian', 'ukrainian', 'hebrew', 'persian'
]);

const VOICE_OPTIONS_BY_LANGUAGE = {
  english: {
    male: [
      { name: 'David (US Male)', voice: 'en_US/cmu-arctic_low' },
      { name: 'Mark (US Male)', voice: 'en_US/ljspeech_low' },
      { name: 'Ryan (UK Male)', voice: 'en_UK/apope_low' }
    ],
    female: [
      { name: 'Sarah (US Female)', voice: 'en_US/ljspeech_low' },
      { name: 'Emma (UK Female)', voice: 'en_UK/southern_english_female_low' },
      { name: 'Jenny (US Female)', voice: 'en_US/cmu-slt_low' }
    ]
  },
  spanish: {
    male: [
      { name: 'Carlos (Spain Male)', voice: 'es_ES/carlfm_low' },
      { name: 'Diego (Mexico Male)', voice: 'es_MX/claude_low' }
    ],
    female: [
      { name: 'Sofia (Spain Female)', voice: 'es_ES/karen_savage_low' },
      { name: 'Maria (Mexico Female)', voice: 'es_MX/ald_low' }
    ]
  },
  french: {
    male: [
      { name: 'Pierre (France Male)', voice: 'fr_FR/tom_low' },
      { name: 'Marc (France Male)', voice: 'fr_FR/upmc_low' }
    ],
    female: [
      { name: 'Amelie (France Female)', voice: 'fr_FR/siwis_low' },
      { name: 'Sophie (France Female)', voice: 'fr_FR/m-ailabs_low' }
    ]
  },
  german: {
    male: [
      { name: 'Klaus (Germany Male)', voice: 'de_DE/thorsten_low' },
      { name: 'Hans (Germany Male)', voice: 'de_DE/m-ailabs_low' }
    ],
    female: [
      { name: 'Eva (Germany Female)', voice: 'de_DE/rebecca_braunert_plunkett_low' },
      { name: 'Greta (Germany Female)', voice: 'de_DE/kerstin_low' }
    ]
  },
  italian: {
    male: [
      { name: 'Marco (Italy Male)', voice: 'it_IT/riccardo-fasol_low' },
      { name: 'Alessandro (Italy Male)', voice: 'it_IT/m-ailabs_low' }
    ],
    female: [
      { name: 'Giulia (Italy Female)', voice: 'it_IT/paola-macci_low' },
      { name: 'Francesca (Italy Female)', voice: 'it_IT/lisa_low' }
    ]
  },
  portuguese: {
    male: [
      { name: 'João (Brazil Male)', voice: 'pt_BR/faber_low' },
      { name: 'Carlos (Spain Male)', voice: 'es_ES/carlfm_low' } // Fallback to Spanish
    ],
    female: [
      { name: 'Ana (Brazil Female)', voice: 'pt_BR/m-ailabs_low' },
      { name: 'Sofia (Spain Female)', voice: 'es_ES/karen_savage_low' } // Fallback to Spanish
    ]
  },
  russian: {
    male: [
      { name: 'Dmitri (Russia Male)', voice: 'ru_RU/multi_low' },
      { name: 'Alexei (Russia Male)', voice: 'ru_RU/m-ailabs_low' }
    ],
    female: [
      { name: 'Katya (Russia Female)', voice: 'ru_RU/hajdurova_low' },
      { name: 'Svetlana (Russia Female)', voice: 'ru_RU/natasha_low' }
    ]
  },
  dutch: {
    male: [
      { name: 'Bart (Netherlands Male)', voice: 'nl/bart-de-leeuw_low' },
      { name: 'Jan (Netherlands Male)', voice: 'nl/flemishguy_low' }
    ],
    female: [
      { name: 'Emma (Netherlands Female)', voice: 'nl/nathalie_low' },
      { name: 'Sophie (Netherlands Female)', voice: 'nl/rdh_low' }
    ]
  },
  polish: {
    male: [
      { name: 'Marek (Poland Male)', voice: 'pl_PL/m-ailabs_low' },
      { name: 'Piotr (Poland Male)', voice: 'pl_PL/gosia_low' }
    ],
    female: [
      { name: 'Anna (Poland Female)', voice: 'pl_PL/darkman_low' },
      { name: 'Kasia (Poland Female)', voice: 'pl_PL/m-ailabs_low' }
    ]
  },
  ukrainian: {
    male: [
      { name: 'Oleksandr (Ukraine Male)', voice: 'uk_UK/m-ailabs_low' },
      { name: 'Dmytro (Ukraine Male)', voice: 'uk_UK/ukrainian_tts_low' }
    ],
    female: [
      { name: 'Oksana (Ukraine Female)', voice: 'uk_UK/lada_low' },
      { name: 'Natasha (Ukraine Female)', voice: 'uk_UK/m-ailabs_low' }
    ]
  },
  finnish: {
    male: [
      { name: 'Harri (Finland Male)', voice: 'fi_FI/harri-tapani-ylilammi_low' },
      { name: 'Mikko (Finland Male)', voice: 'fi_FI/m-ailabs_low' }
    ],
    female: [
      { name: 'Aino (Finland Female)', voice: 'fi_FI/anna-low_low' },
      { name: 'Elina (Finland Female)', voice: 'fi_FI/m-ailabs_low' }
    ]
  },
  hungarian: {
    male: [
      { name: 'Zoltan (Hungary Male)', voice: 'hu_HU/m-ailabs_low' },
      { name: 'Gabor (Hungary Male)', voice: 'hu_HU/bea_low' }
    ],
    female: [
      { name: 'Diana (Hungary Female)', voice: 'hu_HU/diana-majlinger_low' },
      { name: 'Eva (Hungary Female)', voice: 'hu_HU/m-ailabs_low' }
    ]
  },
  greek: {
    male: [
      { name: 'Dimitris (Greece Male)', voice: 'el_GR/m-ailabs_low' },
      { name: 'Nikos (Greece Male)', voice: 'el_GR/rapunzelina_low' }
    ],
    female: [
      { name: 'Maria (Greece Female)', voice: 'el_GR/rapunzelina_low' },
      { name: 'Sofia (Greece Female)', voice: 'el_GR/m-ailabs_low' }
    ]
  },
  // Languages with English fallback but distinct options
  japanese: {
    male: [
      { name: 'Hiroshi (English Male)', voice: 'en_US/cmu-arctic_low' },
      { name: 'Takeshi (English Male)', voice: 'en_US/ljspeech_low' }
    ],
    female: [
      { name: 'Yuki (English Female)', voice: 'en_US/ljspeech_low' },
      { name: 'Sakura (English Female)', voice: 'en_US/cmu-slt_low' }
    ]
  },
  chinese: {
    male: [
      { name: 'Wei (English Male)', voice: 'en_US/cmu-arctic_low' },
      { name: 'Ming (English Male)', voice: 'en_US/ljspeech_low' }
    ],
    female: [
      { name: 'Li (English Female)', voice: 'en_US/ljspeech_low' },
      { name: 'Mei (English Female)', voice: 'en_US/cmu-slt_low' }
    ]
  },
  korean: {
    male: [
      { name: 'Min-jun (Korean Male)', voice: 'ko_KO/kss_low' },
      { name: 'Hyun-woo (English Male)', voice: 'en_US/ljspeech_low' }
    ],
    female: [
      { name: 'So-young (Korean Female)', voice: 'ko_KO/kss_low' },
      { name: 'Ji-hye (English Female)', voice: 'en_US/ljspeech_low' }
    ]
  },
  vietnamese: {
    male: [
      { name: 'Minh (Vietnam Male)', voice: 'vi_VN/vais1000_low' },
      { name: 'Duc (English Male)', voice: 'en_US/ljspeech_low' }
    ],
    female: [
      { name: 'Linh (Vietnam Female)', voice: 'vi_VN/vais1000_low' },
      { name: 'Mai (English Female)', voice: 'en_US/ljspeech_low' }
    ]
  }
};

// Default selections (first male/female option for each language)
const DEFAULT_VOICE_BY_LANGUAGE = {};
Object.keys(VOICE_OPTIONS_BY_LANGUAGE).forEach(lang => {
  DEFAULT_VOICE_BY_LANGUAGE[lang] = {
    voice: VOICE_OPTIONS_BY_LANGUAGE[lang].male[0].voice
  };
});

function normalizeLanguages(langs) {
  if (!Array.isArray(langs)) return [];
  return [...new Set(langs.map(l => String(l).trim().toLowerCase()).filter(Boolean))];
}

function getVoiceOptions(language) {
  const normalizedLang = language.toLowerCase().trim();
  return VOICE_OPTIONS_BY_LANGUAGE[normalizedLang] || null;
}

function getAllLanguagesWithVoices() {
  return Object.keys(VOICE_OPTIONS_BY_LANGUAGE).sort();
}

function findVoiceByName(language, voiceName) {
  const options = getVoiceOptions(language);
  if (!options) return null;
  
  const allVoices = [...options.male, ...options.female];
  return allVoices.find(v => 
    v.name.toLowerCase().includes(voiceName.toLowerCase()) || 
    v.voice === voiceName
  );
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
  
  console.log('[TTS Voice Selection]:', {
    inputLanguages: languages,
    l1: l1,
    l2: l2,
    mappedVoice1: DEFAULT_VOICE_BY_LANGUAGE[l1]?.voice,
    mappedVoice2: l2 ? DEFAULT_VOICE_BY_LANGUAGE[l2]?.voice : undefined,
    customVoices,
    selectedV1: v1,
    selectedV2: v2,
    defaultVoice
  });
  
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
  VOICE_OPTIONS_BY_LANGUAGE,
  normalizeLanguages,
  validateLanguages,
  assignVoices,
  getBestVoiceForLanguage,
  getAlternativeVoices,
  getVoiceOptions,
  getAllLanguagesWithVoices,
  findVoiceByName,
};
