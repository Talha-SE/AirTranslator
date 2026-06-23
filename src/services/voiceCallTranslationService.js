/**
 * Voice Call Translation Service
 * 
 * Real-time audio-to-audio translation using Gemini Live API.
 * The bot joins a Discord voice channel, listens to speech,
 * sends audio to Gemini Live, and plays back translated audio.
 * 
 * @requires @discordjs/voice - Discord voice connection
 * @requires @google/genai - Google Gemini AI SDK
 */

const { 
  joinVoiceChannel, 
  getVoiceConnection, 
  VoiceConnectionStatus,
  EndBehaviorType,
  entersState,
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const prism = require('prism-media');
const { GoogleGenAI } = require('@google/genai');
const { pipeline: streamPipeline } = require('stream/promises');
const { Readable, Transform, PassThrough } = require('stream');
const VoiceCallTranslation = require('../models/VoiceCallTranslation');

// ==============================
// Configuration
// ==============================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// Models — gemini-3.5-live-translate-preview (continuous), gemini-3.1-flash-live-preview & gemini-2.5-flash-native-audio (turn-based)
const MODEL_ID = 'gemini-3.5-live-translate-preview';
const FLASH_MODEL_ID = 'gemini-3.1-flash-live-preview';
const NATIVE_AUDIO_MODEL_ID = 'gemini-2.5-flash-native-audio-preview-12-2025';
const GEMINI_INPUT_RATE = 16000;  // Gemini accepts 16kHz input
const GEMINI_OUTPUT_RATE = 24000; // Gemini outputs translated audio at 24kHz

const GEMINI_LIVE_MODELS = {
  [MODEL_ID]: {
    modelId: MODEL_ID,
    label: 'Live Translate',
    sampleRate: GEMINI_INPUT_RATE,
    encoding: 'LINEAR16',
    supportsBidi: true,
    isTurnBased: false, // continuous mode — uses translationConfig (not speechConfig)
  },
  [FLASH_MODEL_ID]: {
    modelId: FLASH_MODEL_ID,
    label: 'Flash Live',
    sampleRate: GEMINI_INPUT_RATE,
    encoding: 'LINEAR16',
    supportsBidi: true,
    isTurnBased: true, // listens → detects silence → returns translation
  },
  [NATIVE_AUDIO_MODEL_ID]: {
    modelId: NATIVE_AUDIO_MODEL_ID,
    label: 'Native Audio',
    sampleRate: GEMINI_INPUT_RATE,
    encoding: 'LINEAR16',
    supportsBidi: true,
    isTurnBased: true, // batch mode — listens → silence → translated speech
  },
};

/** Silence duration before considering speech ended (ms) */
const SILENCE_DURATION_MS = 1100; // 1.1s silence = end of utterance (reduced from 2s for faster response)

/** Turn-based models use 1.1s silence — faster response, still filters natural pauses */
const FLASH_SILENCE_DURATION_MS = 1100;

// ==============================
// Gemini Voices Configuration
// ==============================
// Official voice list from Google GenKit (30 voices)
const GEMINI_VOICES = {
  'Zephyr': { label: 'Zephyr', description: 'Bright and clear', gender: 'Female' },
  'Puck': { label: 'Puck', description: 'Upbeat and energetic', gender: 'Male' },
  'Charon': { label: 'Charon', description: 'Deep and informative', gender: 'Male' },
  'Kore': { label: 'Kore', description: 'Firm and authoritative', gender: 'Female' },
  'Fenrir': { label: 'Fenrir', description: 'Excitable and dynamic', gender: 'Male' },
  'Leda': { label: 'Leda', description: 'Youthful and bright', gender: 'Female' },
  'Orus': { label: 'Orus', description: 'Balanced and neutral', gender: 'Male' },
  'Aoede': { label: 'Aoede', description: 'Expressive and melodious', gender: 'Female' },
  'Callirrhoe': { label: 'Callirrhoe', description: 'Warm and gentle', gender: 'Female' },
  'Autonoe': { label: 'Autonoe', description: 'Smooth and calm', gender: 'Female' },
  'Enceladus': { label: 'Enceladus', description: 'Bold and resonant', gender: 'Male' },
  'Iapetus': { label: 'Iapetus', description: 'Steady and grounded', gender: 'Male' },
  'Umbriel': { label: 'Umbriel', description: 'Soft and subtle', gender: 'Male' },
  'Algieba': { label: 'Algieba', description: 'Rich and textured', gender: 'Female' },
  'Despina': { label: 'Despina', description: 'Light and airy', gender: 'Female' },
  'Erinome': { label: 'Erinome', description: 'Crisp and precise', gender: 'Female' },
  'Algenib': { label: 'Algenib', description: 'Strong and commanding', gender: 'Male' },
  'Rasalgethi': { label: 'Rasalgethi', description: 'Deep and resonant', gender: 'Male' },
  'Laomedeia': { label: 'Laomedeia', description: 'Melodic and flowing', gender: 'Female' },
  'Achernar': { label: 'Achernar', description: 'Bright and sharp', gender: 'Male' },
  'Alnilam': { label: 'Alnilam', description: 'Warm and inviting', gender: 'Male' },
  'Schedar': { label: 'Schedar', description: 'Deep and thoughtful', gender: 'Female' },
  'Gacrux': { label: 'Gacrux', description: 'Gentle and soothing', gender: 'Male' },
  'Pulcherrima': { label: 'Pulcherrima', description: 'Beautiful and elegant', gender: 'Female' },
  'Achird': { label: 'Achird', description: 'Neutral and clear', gender: 'Female' },
  'Zubenelgenubi': { label: 'Zubenelgenubi', description: 'Balanced and smooth', gender: 'Male' },
  'Vindemiatrix': { label: 'Vindemiatrix', description: 'Vibrant and lively', gender: 'Female' },
  'Sadachbia': { label: 'Sadachbia', description: 'Calm and composed', gender: 'Female' },
  'Sadaltager': { label: 'Sadaltager', description: 'Warm and friendly', gender: 'Male' },
  'Sulafat': { label: 'Sulafat', description: 'Crystal clear', gender: 'Female' },
};

const DEFAULT_VOICE = 'Aoede';
const DEFAULT_MODEL = FLASH_MODEL_ID;
const OPUS_FRAME_DURATION_MS = 20;
const PCM_SAMPLE_RATE = 48000;
const DISCORD_FRAME_SIZE = 960; // 20ms at 48kHz

/** Maximum translated audio buffer size (~5 seconds at 24kHz 16-bit) */
const MAX_BUFFER_SIZE = GEMINI_OUTPUT_RATE * 2 * 5; // 240,000 bytes

/** Gemini reconnection settings */
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;

/** Voice connection reconnect settings */
const VOICE_RECONNECT_WAIT_MS = 5000;
const VOICE_RECONNECT_MAX_ATTEMPTS = 3;

/** Session timeout: 6 hours */
const SESSION_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** Minimum playback buffer in seconds (300ms — play as soon as translation arrives) */
const MIN_PLAYBACK_BUFFER_SECONDS = 0.3;

// ==============================
// Active Connections Map & Start Locks
// ==============================
const activeConnections = new Map();
/** Per-guild locks to prevent concurrent startTranslation calls */
const startLocks = new Map();

/**
 * Get logger instance with scope
 */
function getLogger(guildId) {
  const scope = guildId ? `voice-call:${guildId}` : 'voice-call';
  const LOGGER_LEVELS = ['debug', 'info', 'success', 'warn', 'error'];
  const COLORS = {
    reset: '\x1b[0m', dim: '\x1b[2m',
    gray: '\x1b[90m', blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  };
  const ICONS = { debug: '🐛', info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
  const LEVEL_COLOR = { debug: COLORS.gray, info: COLORS.blue, success: COLORS.green, warn: COLORS.yellow, error: COLORS.red };

  return {
    debug: (msg, meta) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.gray}🐛 DEBUG${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    info: (msg, meta) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.blue}ℹ️ INFO${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    success: (msg, meta) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.green}✅ SUCCESS${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    warn: (msg, meta) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.yellow}⚠️ WARN${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    error: (msg, meta) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.red}❌ ERROR${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
  };
}

// ==============================
// Audio Processing Utilities
// ==============================

/**
 * Downsample PCM audio from 48kHz to target sample rate
 * Simple linear interpolation downsampling
 */
function downsamplePcm(inputBuffer, inputRate, outputRate) {
  if (inputRate === outputRate) return inputBuffer;
  
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(inputBuffer.length / ratio);
  const output = Buffer.alloc(outputLength * 2); // 16-bit samples
  
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    if (srcIndex * 2 + 1 < inputBuffer.length) {
      output.writeInt16LE(inputBuffer.readInt16LE(srcIndex * 2), i * 2);
    }
  }
  
  return output;
}

/**
 * Upsample PCM audio from source rate to target rate
 */
function upsamplePcm(inputBuffer, inputRate, outputRate) {
  if (inputRate === outputRate) return inputBuffer;
  
  const ratio = outputRate / inputRate;
  const outputLength = Math.floor(inputBuffer.length * ratio / 2) * 2;
  const output = Buffer.alloc(outputLength);
  
  for (let i = 0; i < outputLength / 2; i++) {
    const srcIndex = Math.floor(i / ratio);
    if (srcIndex * 2 + 1 < inputBuffer.length) {
      output.writeInt16LE(inputBuffer.readInt16LE(srcIndex * 2), i * 2);
    }
  }
  
  return output;
}

/**
 * Convert Opus packet to PCM buffer using prism-media decoder
 */
function createOpusDecoder() {
  return new prism.opus.Decoder({
    frameSize: DISCORD_FRAME_SIZE,
    channels: 1,
    rate: PCM_SAMPLE_RATE
  });
}

// ==============================
// Gemini Live API Integration
// ==============================

/**
 * Get language display name from code
 */
function getLanguageName(langCode) {
  const names = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
    'ko': 'Korean', 'zh': 'Chinese', 'hi': 'Hindi', 'ur': 'Urdu',
    'ar': 'Arabic', 'tr': 'Turkish', 'nl': 'Dutch', 'sv': 'Swedish',
    'pl': 'Polish', 'id': 'Indonesian', 'vi': 'Vietnamese', 'th': 'Thai',
    'cs': 'Czech', 'ro': 'Romanian', 'hu': 'Hungarian', 'da': 'Danish',
    'fi': 'Finnish', 'no': 'Norwegian', 'ms': 'Malay', 'tl': 'Filipino',
    'el': 'Greek', 'he': 'Hebrew', 'uk': 'Ukrainian', 'bn': 'Bengali',
    'ta': 'Tamil', 'te': 'Telugu', 'mr': 'Marathi', 'gu': 'Gujarati',
    'pa': 'Punjabi', 'kn': 'Kannada', 'ml': 'Malayalam', 'bg': 'Bulgarian',
    'hr': 'Croatian', 'sk': 'Slovak', 'sl': 'Slovenian', 'et': 'Estonian',
    'lv': 'Latvian', 'lt': 'Lithuanian', 'ca': 'Catalan', 'af': 'Afrikaans',
    'sw': 'Swahili', 'my': 'Burmese', 'ne': 'Nepali', 'si': 'Sinhala',
    'auto': 'Auto-Detect'
  };
  return names[langCode?.toLowerCase()] || langCode || 'Unknown';
}

// ==============================
// Core Voice Translation Logic
// ==============================

/**
 * Start voice call translation for a guild
 * @param {string} guildId - Discord guild ID
 * @param {string} voiceChannelId - Voice channel ID to join
 * @param {string} sourceLanguage - Source language code or 'auto'
 * @param {string} targetLanguage - Target language code
 * @param {string} modelId - Gemini model ID
 * @param {Object} client - Discord.js client
 * @returns {Promise<Object>} - Result object
 */
async function startTranslation(guildId, voiceChannelId, sourceLanguage, targetLanguage, modelId, client, voiceName) {
  const log = getLogger(guildId);
  
  // Prevent concurrent starts for the same guild (race condition guard)
  if (startLocks.has(guildId)) {
    log.warn('⚠️ Translation start already in progress for this guild — skipping');
    return { success: false, error: 'Translation is already starting for this guild. Please wait a moment and try again.' };
  }
  
  // Check if already active
  if (activeConnections.has(guildId)) {
    log.warn('Translation already active for this guild');
    return { success: false, error: 'Translation already active for this guild' };
  }

  if (!GEMINI_API_KEY) {
    log.error('Gemini API key not configured');
    return { success: false, error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' };
  }

  // Acquire lock — release in finally block
  startLocks.set(guildId, true);

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      return { success: false, error: 'Guild not found' };
    }

    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel || voiceChannel.type !== 2) {
      return { success: false, error: 'Voice channel not found or invalid' };
    }

    log.info(`🎤 Starting voice translation in channel "${voiceChannel.name}"...`);
    log.info(`🌐 Source: ${getLanguageName(sourceLanguage)} → Target: ${getLanguageName(targetLanguage)}, Model: ${modelId || DEFAULT_MODEL}, Voice: ${voiceName || DEFAULT_VOICE}`);

    // Create the voice connection
    log.info('🔊 Joining voice channel...');
    const connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId: guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    // Wait for connection to be ready
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (e) {
      // Handle AbortError from concurrent start attempts or network issues
      log.error(`❌ Voice connection failed to become ready: ${e.message}`);
      try { connection.destroy(); } catch (d) { /* ignore */ }
      activeConnections.delete(guildId);
      return { success: false, error: `Voice connection failed: ${e.message}` };
    }
    log.success('✅ Voice connection established');
    log.info(`📊 Connection state: ${connection.state.status}, Channel: ${voiceChannel.name} (${voiceChannelId})`);

    // Create connection state
    const state = {
      guildId,
      voiceChannelId,
      connection,
      sourceLanguage,
      targetLanguage,
      modelId: modelId || DEFAULT_MODEL,
      voiceName: voiceName || DEFAULT_VOICE,
      client,
      startTime: Date.now(),
      audioPlayer: createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        }
      }),
      isRunning: true,
      isReconnecting: false,
      geminiSession: null,
      activityTimeout: null,
      lastActivityTime: Date.now(),
      translatedAudioBuffer: Buffer.alloc(0),
      onActivityChange: null,
      userSpeakingCount: 0,
      totalAudioSent: 0,
      totalAudioReceived: 0,
      /** Flash model: accumulate audio parts until turnComplete */
      flashModelAudioParts: [],
      isTurnBased: [FLASH_MODEL_ID, NATIVE_AUDIO_MODEL_ID].includes(modelId || DEFAULT_MODEL),
      /** Map of userId → { pcmBuffer, flushTimer } for active real-time streams */
      activeStreams: new Map(),
    };

    // Subscribe audio player to connection
    connection.subscribe(state.audioPlayer);

    // Connect persistent Gemini Live WebSocket session
    log.info('🔌 Connecting Gemini Live session...');
    await connectGeminiSession(state);

    // Set up real-time audio pipeline
    log.info('🎧 Setting up real-time audio pipeline (streaming PCM chunks every 200ms)...');
    setupRealtimeAudioPipeline(state);

    // Store connection state
    activeConnections.set(guildId, state);

    // Set session timeout (6 hours)
    state.sessionTimeout = setTimeout(async () => {
      log.warn(`⏰ Session timeout reached (${SESSION_MAX_DURATION_MS / 3600000}h) — stopping translation`);
      await stopTranslation(guildId, client);
    }, SESSION_MAX_DURATION_MS);

    // Handle connection state changes with detailed logging
    connection.on(VoiceConnectionStatus.Connecting, () => {
      log.info('🔄 Voice connection is connecting...');
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      log.success('🔊 Voice connection ready');
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      log.warn('⚠️ Voice connection disconnected — attempting reconnect...');
      try {
        // Wait briefly for potential auto-reconnect by Discord.js
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Ready, VOICE_RECONNECT_WAIT_MS),
          entersState(connection, VoiceConnectionStatus.Connecting, VOICE_RECONNECT_WAIT_MS),
        ]);
        log.success('✅ Voice connection reconnected');
        return;
      } catch (e) {
        log.warn(`⚠️ Voice reconnect failed after ${VOICE_RECONNECT_WAIT_MS}ms — stopping translation`);
        await stopTranslation(guildId, client);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      log.info('🗑️ Voice connection destroyed');
      if (activeConnections.has(guildId)) {
        activeConnections.delete(guildId);
        log.info('🧹 Cleaned up active connection state');
      }
    });

    connection.on('error', (error) => {
      log.error(`❌ Voice connection error: ${error.message}`);
    });

    // Update database
    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      {
        isActive: true,
        lastStartedAt: new Date(),
        enabled: true,
      },
      { upsert: true }
    );

    log.success('Voice call translation started successfully');
    return { success: true, message: 'Voice translation started' };
  } catch (error) {
    log.error(`Failed to start translation: ${error.message}`);
    activeConnections.delete(guildId);
    return { success: false, error: error.message };
  } finally {
    // Always release the start lock
    startLocks.delete(guildId);
  }
}

/**
 * Set up the real-time audio pipeline.
 *
 * KEY DESIGN: Instead of buffering ALL audio until silence and sending one big chunk,
 * we send small PCM chunks to Gemini EVERY 200ms as audio arrives.
 * This is true real-time streaming — Gemini starts translating immediately.
 *
 * Each user gets a persistent receiver. While speaking, PCM data is accumulated
 * and flushed to Gemini every 200ms (~6400 bytes per flush at 16kHz 16-bit mono).
 */
function setupRealtimeAudioPipeline(state) {
  const log = getLogger(state.guildId);
  const receiver = state.connection.receiver;

  log.info('🔍 Listening for speakers in voice channel (batch utterance mode)...');

  /**
   * BATCH MODE: Accumulate the ENTIRE utterance, then send to Gemini at once.
   * Gemini receives a complete sentence → produces a coherent translation.
   * Speech ends after 2s of silence (EndBehaviorType.AfterSilence).
   */
  receiver.speaking.on('start', (userId) => {
    // Skip the bot's own audio — prevent echo loop
    if (userId === state.client.user.id) return;

    // If this user already has an active stream, skip — avoid duplicate streams
    // Discord VAD fires multiple start/end during one speech session
    if (state.activeStreams.has(userId)) {
      return;
    }

    const user = state.client.users.cache.get(userId);
    const username = user?.username || userId;
    state.userSpeakingCount++;
    state.lastActivityTime = Date.now();

    log.info(`🗣️ User started speaking: ${username} (#${state.userSpeakingCount})`);

    if (state.onActivityChange) {
      state.onActivityChange('speaking', userId);
    }

    // Create a persistent audio stream — ends after silence
    // Flash model: 2s silence (turn-based, model detects end of speech)
    // Translate model: 3s silence (continuous, more tolerance for pauses)
    const silenceDuration = state.isTurnBased ? FLASH_SILENCE_DURATION_MS : SILENCE_DURATION_MS;
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: silenceDuration,
      },
    });

    // Decode Opus → PCM
    const decoder = createOpusDecoder();
    // Catch decoder errors to prevent process crash from invalid Opus packets
    decoder.on('error', (err) => {
      log.warn(`⚠️ Opus decoder error for ${username}: ${err.message}`);
    });

    // Track stream IMMEDIATELY so duplicate start events are blocked
    state.activeStreams.set(userId, { decoder, totalBytes: 0, audioStream, pcmChunks: [], username });

    const pcmStream = audioStream.pipe(decoder);

    // Accumulate FULL utterance — no periodic flushing
    const streamInfo = state.activeStreams.get(userId);
    const pcmChunks = streamInfo.pcmChunks;
    let totalBytes = 0;

    pcmStream.on('data', (chunk) => {
      pcmChunks.push(chunk);
      totalBytes += chunk.length;
      state.lastActivityTime = Date.now();
    });

    pcmStream.on('end', async () => {
      // Clean up decoder and stream tracking
      const info = state.activeStreams.get(userId);
      if (info) {
        try { info.decoder.destroy(); } catch (e) { /* ignore */ }
        state.activeStreams.delete(userId);
      }

      // Skip empty utterances
      if (pcmChunks.length === 0 || !state.geminiSession || !state.isRunning) {
        const durationMs = Math.round((totalBytes / 2) / PCM_SAMPLE_RATE * 1000);
        log.debug(`⏹️ ${username}: Speech ended — empty (${(totalBytes / 1024).toFixed(1)} KB, ${durationMs}ms)`);
        return;
      }

      // Combine ALL chunks into one full utterance
      const fullUtterance = Buffer.concat(pcmChunks);
      const durationMs = Math.round((fullUtterance.length / 2) / PCM_SAMPLE_RATE * 1000);

      // Skip tiny audio fragments (< 200ms) — likely mic clicks/breaths, not real speech
      if (durationMs < 200) {
        log.debug(`⏹️ ${username}: Speech too short (${durationMs}ms), skipping`);
        return;
      }

      log.info(`⏹️ ${username}: Speech ended — sending full utterance (${(fullUtterance.length / 1024).toFixed(1)} KB PCM, ${durationMs}ms)`);

      // Downsample 48kHz → 16kHz for Gemini input
      const downsampled = downsamplePcm(fullUtterance, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
      if (downsampled.length === 0) {
        log.warn(`⚠️ ${username}: Downsampled audio empty, skipping`);
        return;
      }

      // Send the complete utterance to Gemini in one batch
      try {
        await sendChunkToGemini(state, downsampled);
        log.success(`📤 Sent full utterance to Gemini (${(downsampled.length / 1024).toFixed(1)} KB, ${durationMs}ms) → awaiting translation`);
      } catch (err) {
        log.error(`❌ Failed to send utterance to Gemini: ${err.message}`);
      }
    });

    audioStream.on('error', (err) => {
      log.error(`❌ Audio stream error for ${username}: ${err.message}`);
      const info = state.activeStreams.get(userId);
      if (info) {
        try { info.decoder.destroy(); } catch (e) { /* ignore */ }
        state.activeStreams.delete(userId);
      }
    });
  });

  receiver.speaking.on('end', (userId) => {
    const user = state.client.users.cache.get(userId);
    log.debug(`🔇 User stopped speaking: ${user?.username || userId}`);
    if (state.onActivityChange) {
      state.onActivityChange('silence', userId);
    }
  });

  // Handle audio playback state — when current chunk finishes, try playing next batch
  state.audioPlayer.on(AudioPlayerStatus.Idle, () => {
    if (state.translatedAudioBuffer.length > 0) {
      playTranslatedAudio(state);
    }
  });

  state.audioPlayer.on(AudioPlayerStatus.Playing, () => {
    log.debug('▶️ Audio player started playing');
  });

  state.audioPlayer.on('error', (error) => {
    log.error(`❌ Audio player error: ${error.message}`);
  });

  log.success('✅ Audio pipeline ready — batch mode (full utterance → Gemini → translation)');
}

/**
 * Build the config for gemini-3.5-live-translate-preview.
 * Uses dedicated translationConfig — built-in translation, no system instructions needed.
 */
function buildTranslateConfig(state) {
  const tgtLang = state.targetLanguage || 'en';
  return {
    responseModalities: ['AUDIO'],
    translationConfig: {
      targetLanguageCode: tgtLang,
      echoTargetLanguage: false,
    },
  };
}

/**
 * Build a system instruction for the turn-based models (Flash Live, Native Audio).
 * These models don't use translationConfig — they need a prompt
 * telling them to translate speech and respond with audio only.
 */
function buildTranslationSystemInstruction(sourceLanguage, targetLanguage) {
  const tgtName = getLanguageName(targetLanguage);
  return [
    `You are a translator. Auto-detect the source language and translate speech into ${tgtName}.`,
    `Give translation only. Do NOT chat, reply, or add anything else.`,
  ].join('\n');
}

/**
 * Build the config for gemini-3.1-flash-live-preview.
 * This model uses speechConfig + contextWindowCompression (not translationConfig).
 * It listens, detects silence, and returns translated audio as a turn.
 */
function buildFlashLiveConfig(state) {
  const voiceName = state.voiceName || 'Zephyr';
  return {
    responseModalities: ['AUDIO'],
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    },
    contextWindowCompression: {
      triggerTokens: '104857',
      slidingWindow: { targetTokens: '52428' },
    },
  };
}

/**
 * Build the config for gemini-2.5-flash-native-audio-preview.
 * Native audio model — batch mode with speechConfig, mediaResolution, context compression.
 * Uses system instruction for translation-only behavior.
 */
function buildNativeAudioConfig(state) {
  const voiceName = state.voiceName || 'Aoede';
  return {
    responseModalities: ['AUDIO'],
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    },
    contextWindowCompression: {
      triggerTokens: '104857',
      slidingWindow: { targetTokens: '52428' },
    },
  };
}

/**
 * Connect a persistent Gemini Live WebSocket session for the guild.
 * This session stays open and streams audio bidirectionally.
 */
async function connectGeminiSession(state) {
  const log = getLogger(state.guildId);
  const model = GEMINI_LIVE_MODELS[state.modelId] || GEMINI_LIVE_MODELS[DEFAULT_MODEL];
  const isFlash = state.modelId === FLASH_MODEL_ID;
  const isNativeAudio = state.modelId === NATIVE_AUDIO_MODEL_ID;
  const isTurnBasedModel = isFlash || isNativeAudio;

  log.info(`🔌 Opening Gemini Live WebSocket session for model: ${state.modelId}...`);

  const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Build config based on model type
  let config;
  if (isNativeAudio) {
    config = buildNativeAudioConfig(state);
    log.info(`📖 Using Native Audio config (speechConfig, voice: ${state.voiceName || 'Aoede'}, context compression enabled)`);
  } else if (isFlash) {
    config = buildFlashLiveConfig(state);
    log.info(`📖 Using Flash Live config (speechConfig, voice: ${state.voiceName || 'Zephyr'}, context compression enabled)`);
  } else {
    config = buildTranslateConfig(state);
    log.info(`📖 Using translationConfig (target: ${state.targetLanguage || 'en'})`);
  }

  const session = await genAI.live.connect({
    model: model.modelId,
    config,
    callbacks: {
      onopen: () => {
        log.success('✅ Gemini Live WebSocket session connected');
      },
      onmessage: (message) => {
        try {
          if (isTurnBasedModel) {
            // Turn-based models (Flash Live, Native Audio): buffer audio parts until turnComplete
            const modelTurn = message?.serverContent?.modelTurn;
            if (modelTurn?.parts) {
              for (const part of modelTurn.parts) {
                if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData?.data) {
                  state.flashModelAudioParts.push(part.inlineData.data);
                }
                // Log any text parts for debugging
                if (part.text) {
                  log.debug(`📝 Turn-based model text: ${part.text}`);
                }
              }
            }

            // When turn is complete, concatenate all buffered audio and play
            if (message?.serverContent?.turnComplete) {
              if (state.flashModelAudioParts.length > 0) {
                const combined = Buffer.concat(
                  state.flashModelAudioParts.map(d => Buffer.from(d, 'base64'))
                );
                state.flashModelAudioParts = [];

                if (combined.length > 0) {
                  state.totalAudioReceived += combined.length;
                  const translatedDurationMs = Math.round((combined.length / 2) / GEMINI_OUTPUT_RATE * 1000);
                  log.success(`🔊 Turn-based model complete — received ${(combined.length / 1024).toFixed(1)} KB translated audio (${translatedDurationMs}ms)`);

                  // Queue the audio for playback (cap at MAX_BUFFER_SIZE)
                  if (state.translatedAudioBuffer.length + combined.length > MAX_BUFFER_SIZE) {
                    const overflow = state.translatedAudioBuffer.length + combined.length - MAX_BUFFER_SIZE;
                    state.translatedAudioBuffer = state.translatedAudioBuffer.subarray(overflow);
                    log.warn(`⚠️ Audio buffer overflow — dropped ${(overflow / 1024).toFixed(1)} KB of oldest audio`);
                  }
                  state.translatedAudioBuffer = Buffer.concat([
                    state.translatedAudioBuffer,
                    combined,
                  ]);

                  // Start playing if idle
                  if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
                    log.info(`▶️ Starting playback of ${isNativeAudio ? 'Native Audio' : 'Flash Live'} translated audio...`);
                    playTranslatedAudio(state);
                  }
                }
              }
            }
          } else {
            // Continuous model: play audio chunks as they arrive
            const modelTurn = message?.serverContent?.modelTurn;
            if (modelTurn?.parts) {
              let audioParts = 0;
              for (const part of modelTurn.parts) {
                if (part.inlineData?.mimeType?.startsWith('audio/')) {
                  const audioData = Buffer.from(part.inlineData.data, 'base64');
                  if (audioData.length > 0) {
                    audioParts++;
                    state.totalAudioReceived += audioData.length;
                    const translatedDurationMs = Math.round((audioData.length / 2) / GEMINI_OUTPUT_RATE * 1000);
                    log.debug(`🔊 Received translated audio chunk: ${(audioData.length / 1024).toFixed(1)} KB (${translatedDurationMs}ms)`);

                    // Queue the audio for playback (cap at MAX_BUFFER_SIZE to prevent unbounded growth)
                    if (state.translatedAudioBuffer.length + audioData.length > MAX_BUFFER_SIZE) {
                      const overflow = state.translatedAudioBuffer.length + audioData.length - MAX_BUFFER_SIZE;
                      state.translatedAudioBuffer = state.translatedAudioBuffer.subarray(overflow);
                      log.warn(`⚠️ Audio buffer overflow — dropped ${(overflow / 1024).toFixed(1)} KB of oldest audio`);
                    }
                    state.translatedAudioBuffer = Buffer.concat([
                      state.translatedAudioBuffer,
                      audioData,
                    ]);

                    // Start playing if idle
                    if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
                      log.info('▶️ Starting playback of translated audio...');
                      playTranslatedAudio(state);
                    }
                  }
                }
              }
              if (audioParts > 0) {
                log.success(`✅ Received ${audioParts} audio part(s) from Gemini Live`);
              }
            }
          }
        } catch (err) {
          log.error(`❌ Error processing Gemini Live response: ${err.message}`);
        }
      },
      onerror: (error) => {
        log.error(`❌ Gemini Live WebSocket error: ${error?.message || JSON.stringify(error)}`);
      },
      onclose: (event) => {
        const closeCode = event?.code || 'unknown';
        log.warn(`🔌 Gemini Live WebSocket closed (code: ${closeCode})`);
        state.geminiSession = null;
        // Attempt reconnection if still running
        if (state.isRunning && !state.isReconnecting) {
          state.isReconnecting = true;
          reconnectGeminiSession(state).catch(() => {});
        }
      },
    },
  });

  state.geminiSession = session;
  state.isReconnecting = false;

  // For turn-based models: send system instruction to set up translation context
  // NOTE: This must be AFTER connect() resolves, not inside onopen, to avoid TDZ error
  if (isTurnBasedModel) {
    try {
      const systemPrompt = buildTranslationSystemInstruction(
        state.sourceLanguage, state.targetLanguage
      );
      session.sendClientContent({
        turns: [{ text: systemPrompt }],
        turnComplete: true,
      });
      log.info(`📤 Sent translation system instruction to ${isNativeAudio ? 'Native Audio' : 'Flash Live'} model`);
    } catch (err) {
      log.error(`❌ Failed to send system instruction: ${err.message}`);
    }
  }

  const modeLabel = isNativeAudio ? 'Native Audio batch' : isFlash ? 'Flash Live turn-based' : 'Live Translate continuous';
  log.success(`✅ Gemini Live session established (${modeLabel} mode)`);
  return session;
}

/**
 * Attempt to reconnect Gemini Live session with exponential backoff.
 * Retries up to MAX_RECONNECT_ATTEMPTS times.
 */
async function reconnectGeminiSession(state) {
  const log = getLogger(state.guildId);

  for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    log.info(`🔄 Gemini reconnection attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    if (!state.isRunning || state.geminiSession) {
      // Already connected or stopped — nothing to do
      state.isReconnecting = false;
      return;
    }

    try {
      await connectGeminiSession(state);
      log.success(`✅ Gemini reconnected successfully on attempt ${attempt}`);
      state.isReconnecting = false;
      return;
    } catch (err) {
      log.error(`❌ Gemini reconnection attempt ${attempt} failed: ${err.message}`);
    }
  }

  log.error(`❌ Gemini reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts — translation may be degraded`);
  state.isReconnecting = false;
}

/**
 * Send audio PCM data to Gemini Live API for translation
 * Uses the persistent WebSocket session instead of REST calls.
 */
async function sendChunkToGemini(state, pcmBuffer) {
  const log = getLogger(state.guildId);

  try {
    if (!state.geminiSession) {
      log.warn('⚠️ No active Gemini Live session, reconnecting...');
      await connectGeminiSession(state);
    }

    const audioBase64 = pcmBuffer.toString('base64');

    // Use 'audio' key — NOT 'media' (media causes WebSocket close 1011)
    state.geminiSession.sendRealtimeInput({
      audio: {
        data: audioBase64,
        mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
      },
    });

    state.totalAudioSent += pcmBuffer.length;
  } catch (error) {
    log.error(`❌ Gemini Live send error: ${error.message}`);
    state.geminiSession = null;
    if (error.message?.includes('API_KEY') || error.message?.includes('PERMISSION_DENIED')) {
      log.error('🔑 Gemini API key may be invalid or model not available - check your GEMINI_API_KEY');
    }
  }
}

/**
 * Play translated audio through the Discord voice connection.
 * Buffers audio until there's enough for a decent playback chunk (~1s),
 * then encodes and plays it. This avoids choppy tiny clips.
 */
function playTranslatedAudio(state) {
  if (state.translatedAudioBuffer.length === 0) return;
  
  const log = getLogger(state.guildId);
  
  // Wait until we have at least 500ms of audio (24kHz * 2 bytes * 0.5s = 24000 bytes)
  const minBufferSize = GEMINI_OUTPUT_RATE * 2 * MIN_PLAYBACK_BUFFER_SECONDS;
  if (state.translatedAudioBuffer.length < minBufferSize) {
    return;
  }

  try {
    const bufferSizeKb = (state.translatedAudioBuffer.length / 1024).toFixed(1);
    
    // Take the buffered audio and clear
    const pcmData = state.translatedAudioBuffer;
    state.translatedAudioBuffer = Buffer.alloc(0);
    
    // Upsample 24kHz → 48kHz for Discord
    const upsampledPcm = upsamplePcm(pcmData, GEMINI_OUTPUT_RATE, PCM_SAMPLE_RATE);
    log.debug(`🔊 Playing ${bufferSizeKb} KB audio (upsampled to ${(upsampledPcm.length / 1024).toFixed(1)} KB @ ${PCM_SAMPLE_RATE}Hz)`);

    // StreamType.Raw = PCM input, @discordjs/voice auto-encodes to Opus internally
    // Raw defaults to stereo, so convert mono → stereo by duplicating channels
    const stereoBuffer = Buffer.alloc(upsampledPcm.length * 2);
    for (let i = 0; i < upsampledPcm.length; i += 2) {
      const sample = upsampledPcm.readInt16LE(i);
      stereoBuffer.writeInt16LE(sample, i * 2);      // Left channel
      stereoBuffer.writeInt16LE(sample, i * 2 + 2);   // Right channel (copy)
    }

    const resource = createAudioResource(Readable.from([stereoBuffer]), {
      inputType: StreamType.Raw,
    });

    state.audioPlayer.play(resource);
    log.debug(`▶️ Playing translated audio in voice channel`);
  } catch (error) {
    log.error(`❌ Error playing translated audio: ${error.message}`);
  }
}

/**
 * Stop voice call translation for a guild
 * @param {string} guildId - Discord guild ID
 * @param {Object} client - Discord.js client (optional)
 * @returns {Promise<Object>} - Result object
 */
async function stopTranslation(guildId, client) {
  const log = getLogger(guildId);
  
  try {
    const state = activeConnections.get(guildId);
    
    if (!state) {
      log.warn('⚠️ No active translation to stop');
      return { success: false, error: 'No active translation' };
    }

    const uptime = state.startTime ? Math.round((Date.now() - state.startTime) / 1000) : '?';
    log.info(`🛑 Stopping voice call translation (uptime: ${uptime}s)`);
    log.info(`📊 Stats: ${state.userSpeakingCount || 0} speech events, ${(state.totalAudioSent || 0) / 1024} KB sent, ${(state.totalAudioReceived || 0) / 1024} KB received`);

    // Clear session timeout
    if (state.sessionTimeout) {
      clearTimeout(state.sessionTimeout);
      state.sessionTimeout = null;
    }

    // Destroy all active stream decoders
    for (const [userId, streamInfo] of state.activeStreams) {
      try { streamInfo.decoder.destroy(); } catch (e) { /* ignore */ }
    }
    state.activeStreams.clear();

    // Clear translated audio buffer
    state.translatedAudioBuffer = Buffer.alloc(0);

    // Destroy the voice connection
    if (state.connection) {
      log.info('🔌 Destroying voice connection...');
      state.connection.destroy();
    }

    // Close Gemini Live WebSocket session
    if (state.geminiSession) {
      log.info('🔌 Closing Gemini Live WebSocket session...');
      try {
        state.geminiSession.close();
      } catch (e) { /* ignore close errors */ }
      state.geminiSession = null;
    }

    // Stop audio player
    if (state.audioPlayer) {
      log.info('⏹️ Stopping audio player...');
      state.audioPlayer.stop();
    }

    // Clean up state
    state.isRunning = false;
    activeConnections.delete(guildId);

    // Update database
    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      {
        isActive: false,
        lastStoppedAt: new Date(),
      }
    );

    log.success('✅ Voice call translation stopped successfully');
    return { success: true, message: 'Voice translation stopped' };
  } catch (error) {
    log.error(`❌ Error stopping translation: ${error.message}`);
    activeConnections.delete(guildId);
    return { success: false, error: error.message };
  }
}

/**
 * Check if translation is active for a guild
 */
function isTranslationActive(guildId) {
  return activeConnections.has(guildId);
}

/**
 * Get translation status for a guild
 */
function getTranslationStatus(guildId) {
  const state = activeConnections.get(guildId);
  if (!state) {
    return { active: false };
  }
  
  return {
    active: true,
    voiceChannelId: state.voiceChannelId,
    sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage,
    modelId: state.modelId,
    voiceName: state.voiceName,
    lastActivity: state.lastActivityTime,
    uptime: Date.now() - (state.startTime || Date.now()),
  };
}

/**
 * Register an activity change callback for a guild
 */
function onActivityChange(guildId, callback) {
  const state = activeConnections.get(guildId);
  if (state) {
    state.onActivityChange = callback;
  }
}

/**
 * Get active connections count
 */
function getActiveCount() {
  return activeConnections.size;
}

/**
 * Clean up all active connections (for bot shutdown)
 */
async function cleanupAll() {
  const guildIds = Array.from(activeConnections.keys());
  for (const guildId of guildIds) {
    try {
      await stopTranslation(guildId);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Register cleanup on process exit
process.on('SIGINT', cleanupAll);
process.on('SIGTERM', cleanupAll);

module.exports = {
  startTranslation,
  stopTranslation,
  isTranslationActive,
  getTranslationStatus,
  onActivityChange,
  getActiveCount,
  cleanupAll,
  getLanguageName,
  GEMINI_VOICES,
  GEMINI_LIVE_MODELS,
  DEFAULT_VOICE,
  DEFAULT_MODEL,
  MODEL_ID,
  FLASH_MODEL_ID,
  NATIVE_AUDIO_MODEL_ID,
};
