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
// Native Opus decoder (@discordjs/opus) — lower CPU + better packet-loss handling
// than the pure-JS prism-media decoder. If the native binary is missing/broken
// (e.g. prebuilt .node not downloaded), fall back to prism-media so the bot
// never crashes. Also try opusscript as a second fallback.
let OpusDecoderClass = null;
try {
  const opusPkg = require('@discordjs/opus');
  // @discordjs/opus v0.10 exposes `OpusEncoder`/`OpusDecoder` classes
  OpusDecoderClass = opusPkg?.OpusDecoder || opusPkg?.default?.OpusDecoder || null;
} catch (e) {
  OpusDecoderClass = null; // native binary unavailable — use fallback
}
const { GoogleGenAI } = require('@google/genai');
const { pipeline: streamPipeline } = require('stream/promises');
const { Readable, Transform, PassThrough } = require('stream');
const VoiceCallTranslation = require('../models/VoiceCallTranslation');
const { createUserVAD, VAD_SPEECH_THRESHOLD } = require('./vadService');
const { SampleRate: SampleRateStream } = require('libsamplerate');

// ==============================
// Cached GoogleGenAI Client (reused across reconnects)
// ==============================
let cachedGenAIClient = null;
function getGenAIClient() {
  if (!cachedGenAIClient) {
    cachedGenAIClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return cachedGenAIClient;
}

// ==============================
// Configuration
// ==============================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// Models — gemini-3.1-flash-live-preview & gemini-2.5-flash-native-audio (turn-based)
const FLASH_MODEL_ID = 'gemini-3.1-flash-live-preview';
const NATIVE_AUDIO_MODEL_ID = 'gemini-2.5-flash-native-audio-preview-12-2025';
const GEMINI_INPUT_RATE = 16000;  // Gemini accepts 16kHz input
const GEMINI_OUTPUT_RATE = 24000; // Gemini outputs translated audio at 24kHz

const GEMINI_LIVE_MODELS = {
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

/** Turn-based models use 1.5s silence — faster response, still filters natural pauses */
const FLASH_SILENCE_DURATION_MS = 1500;

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

/** Maximum translated audio buffer size (~20 minutes at 24kHz 16-bit) */
const MAX_BUFFER_SIZE = GEMINI_OUTPUT_RATE * 2 * 1200; // ~57.6MB

/** Gemini reconnection settings */
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;

/** Voice connection reconnect settings */
const VOICE_RECONNECT_WAIT_MS = 5000;
const VOICE_RECONNECT_MAX_ATTEMPTS = 3;

/** Session timeout: 6 hours */
const SESSION_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** Free daily VCT limit for non-premium servers (minutes) */
const FREE_DAILY_LIMIT_MINUTES = 60;

/** Minimum playback buffer in seconds (300ms — play as soon as translation arrives) */
const MIN_PLAYBACK_BUFFER_SECONDS = 0.3;

/** Playback chunk duration in seconds — play in bounded slices instead of one huge buffer */
const PLAYBACK_CHUNK_SECONDS = 1.0;

/** Silence tail appended to end of translated audio to prevent Opus interpolation artifacts (ms) */
const SILENCE_TAIL_MS = 100;

/** Minimum streaming buffer bytes before playback starts (0.3s at 24kHz 16-bit mono) */
const MIN_STREAMING_BUFFER_BYTES = GEMINI_OUTPUT_RATE * 2 * MIN_PLAYBACK_BUFFER_SECONDS;

/** Maximum items in Gemini send queue before dropping oldest chunks */
const MAX_SEND_QUEUE_ITEMS = 30;

/** How often to sweep voice channel for missing subscriptions (ms) */
const SUBSCRIPTION_SWEEP_INTERVAL_MS = 8000;

/** Delay before re-subscribing after a stream ends or decoder error (ms) */
const STREAM_RECOVERY_DELAY_MS = 500;

/** Max recovery attempts per user before giving up */
const MAX_STREAM_RECOVERY_ATTEMPTS = 5;

/** Max number of flashModelAudioParts before dropping oldest (prevents unbounded growth for turn-based models) */
const MAX_FLASH_MODEL_PARTS = 10000; // Support ~16 min of audio at ~100ms parts

/** VAD: Minimum speech probability to consider audio as speech */
const VAD_MIN_SPEECH_PROB = 0.4;

/** VAD: Max consecutive noise frames before skipping audio send */
const VAD_MAX_NOISE_FRAMES = 20;

/** VAD: Min speech ratio (speech/total frames) required to send utterance to Gemini */
const VAD_MIN_SPEECH_RATIO = 0.15;

/** How often to force-flush accumulated PCM for turn-based models (prevents buffer bloat on long speech) */
const TURN_BASED_FLUSH_INTERVAL_MS = 30000; // 30s

// ==============================
// Input audio volume boost
// ==============================
// Quiet Discord mics can be hard for Gemini to understand. Boost the 16 kHz
// input PCM before it is base64-sent (applied once in doSendToGemini, which
// both the force-flush and utterance-end paths route through). 1.8x is a safe
// gain; raise it if Gemini still struggles with very quiet speakers.
const INPUT_AUDIO_GAIN = 1.8;

/**
 * Amplify 16-bit mono PCM samples by a gain factor with soft clipping so loud
 * samples don't distort harshly. Returns a NEW Buffer (input untouched).
 * @param {Buffer} pcm - 16-bit little-endian mono PCM
 * @param {number} gain - multiplier (e.g. 1.8)
 * @returns {Buffer}
 */
function amplifyPcm(pcm, gain) {
  if (!pcm || pcm.length === 0 || !gain || gain === 1) return pcm;
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i += 2) {
    let s = pcm.readInt16LE(i) * gain;
    // Soft clip keeps loud input clean instead of hard clipping
    if (s > 32767) s = 32767;
    else if (s < -32768) s = -32768;
    out.writeInt16LE(Math.round(s), i);
  }
  return out;
}

// ==============================
// Active Connections Map & Start Locks
// ==============================
const activeConnections = new Map();
/** Per-guild locks to prevent concurrent startTranslation calls */
const startLocks = new Map();
/** Cached loggers per guild — avoids allocating new objects every call */
const loggerCache = new Map();

/**
 * Get cached logger instance with scope.
 */
function getLogger(guildId) {
  const cacheKey = guildId || '__global__';
  if (loggerCache.has(cacheKey)) return loggerCache.get(cacheKey);

  const scope = guildId ? `voice-call:${guildId}` : 'voice-call';
  const COLORS = {
    reset: '\x1b[0m', dim: '\x1b[2m',
    gray: '\x1b[90m', blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  };

  const logger = {
    debug: (msg) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.gray}🐛 DEBUG${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    info: (msg) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.blue}ℹ️ INFO${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    success: (msg) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.green}✅ SUCCESS${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    warn: (msg) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.yellow}⚠️ WARN${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
    error: (msg) => console.log(`${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ${COLORS.red}❌ ERROR${COLORS.reset} ${COLORS.dim}[${scope}]${COLORS.reset} ${msg}`),
  };

  loggerCache.set(cacheKey, logger);
  return logger;
}

// ==============================
// Audio Processing Utilities (libsamplerate - Windowed Sinc)
// ==============================

/**
 * Synchronous resampler using libsamplerate's native transform.
 * Wraps the async Stream API to expose a sync process() method.
 */
class SyncResampler {
  constructor(opts) {
    this.stream = new SampleRateStream(opts);
    this.output = [];
    this.stream.on('data', (chunk) => this.output.push(chunk));
  }
  
  process(buffer) {
    this.output = [];
    this.stream.write(buffer);
    // Force flush by ending and recreating
    this.stream.end();
    // Synchronously collect (stream events fire in same tick for sync data)
    return Buffer.concat(this.output);
  }
}

/** No caching — SyncResampler ends the stream after each call, so reuse is broken */


/**
 * Get or create a resampler instance for a given conversion.
 * Reuses instances to maintain filter state across calls (better quality).
 * 
 * @param {number} fromRate - Source sample rate
 * @param {number} toRate - Target sample rate
 * @returns {SyncResampler} - libsamplerate wrapper
 */
function getResampler(fromRate, toRate) {
  return new SyncResampler({
    type: 1, // SRC_SINC_MEDIUM_QUALITY (best balance of quality/speed)
    channels: 1,
    fromRate: fromRate,
    fromDepth: 16,
    toRate: toRate,
    toDepth: 16,
  });
}

/**
 * Downsample PCM audio from input rate to target rate using libsamplerate.
 * Uses Windowed Sinc interpolation (SRC_SINC_MEDIUM_QUALITY) for professional-grade quality.
 * Proper anti-aliasing filter prevents frequency folding.
 * 
 * @param {Buffer} inputBuffer - 16-bit PCM input (mono)
 * @param {number} inputRate - Input sample rate (e.g., 48000)
 * @param {number} outputRate - Output sample rate (e.g., 16000)
 * @returns {Buffer} - Downsampled 16-bit PCM
 */
function downsamplePcm(inputBuffer, inputRate, outputRate) {
  if (inputRate === outputRate) return inputBuffer;
  if (inputBuffer.length === 0) return inputBuffer;
  
  try {
    const resampler = getResampler(inputRate, outputRate);
    return resampler.process(inputBuffer);
  } catch (err) {
    // Fallback: simple decimation if libsamplerate fails
    const ratio = inputRate / outputRate;
    const inputSamples = inputBuffer.length / 2;
    const outputLength = Math.floor(inputSamples / ratio);
    const output = Buffer.alloc(outputLength * 2);
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.floor(i * ratio);
      if (srcIndex * 2 + 1 < inputBuffer.length) {
        output.writeInt16LE(inputBuffer.readInt16LE(srcIndex * 2), i * 2);
      }
    }
    return output;
  }
}

/**
 * Upsample PCM audio from source rate to target rate using libsamplerate.
 * Uses Windowed Sinc interpolation for high-quality sample rate conversion.
 * 
 * @param {Buffer} inputBuffer - 16-bit PCM input (mono)
 * @param {number} inputRate - Input sample rate (e.g., 24000)
 * @param {number} outputRate - Target sample rate (e.g., 48000)
 * @returns {Buffer} - Upsampled 16-bit PCM
 */
function upsamplePcm(inputBuffer, inputRate, outputRate) {
  if (inputRate === outputRate) return inputBuffer;
  if (inputBuffer.length === 0) return inputBuffer;
  
  try {
    const resampler = getResampler(inputRate, outputRate);
    return resampler.process(inputBuffer);
  } catch (err) {
    // Fallback: simple interpolation if libsamplerate fails
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
}

/**
 * Convert Opus packet to PCM buffer.
 * Uses the native @discordjs/opus decoder when available (lower CPU, better
 * packet-loss handling), falling back to the pure-JS prism-media decoder if
 * the native binary is missing/broken (e.g. no prebuild for this Node version).
 */
function createOpusDecoder() {
  // Native decoder (OpusDecoderClass) — supports { rate, channels } via a
  // Transform-like stream; verified available only if the .node binary loads.
  if (OpusDecoderClass) {
    try {
      const native = new OpusDecoderClass({ rate: PCM_SAMPLE_RATE, channels: 1 });
      // prism-media Decoder emits 'data' after ._transform; the native class
      // also exposes a readable/transform surface usable via pipe(). If it has
      // no pipe surface, throw so we fall back to prism-media.
      if (native && typeof native.pipe === 'function') {
        return native;
      }
    } catch (e) {
      // Native decoder failed to construct — fall through to prism-media
    }
  }
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
    'sw': 'Swahili', 'zh-tw': 'Chinese (Traditional)', 'fa': 'Persian', 'sr': 'Serbian',
    'my': 'Burmese', 'ne': 'Nepali', 'si': 'Sinhala',
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
 * @param {number|null} remainingMinutes - Free minutes remaining for non-premium servers
 * @returns {Promise<Object>} - Result object
 */
async function startTranslation(guildId, voiceChannelId, sourceLanguage, targetLanguage, modelId, client, voiceName, remainingMinutes = null) {
  const log = getLogger(guildId);
  
  // Prevent concurrent starts for the same guild (race condition guard)
  if (startLocks.has(guildId)) {
    log.warn('⚠️ Translation start already in progress for this guild — skipping');
    return { success: false, error: 'Translation is already starting for this guild. Please wait a moment and try again.' };
  }
  
  // Check if already active — with stale-state cleanup
  if (activeConnections.has(guildId)) {
    const existingState = activeConnections.get(guildId);
    const connStatus = existingState?.connection?.state?.status;
    if (connStatus === VoiceConnectionStatus.Destroyed || connStatus === VoiceConnectionStatus.Disconnected) {
      log.warn(`🧹 Found stale connection (${connStatus}) — cleaning up before restart`);
      existingState.isRunning = false;
      activeConnections.delete(guildId);
      // Fully clean up the old state
      await stopTranslation(guildId, client).catch(() => {});
    } else {
      log.warn('Translation already active for this guild');
      return { success: false, error: 'Translation already active for this guild' };
    }
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
      /** Chunk-list approach: store translated audio chunks, concat only at playback time */
      translatedChunks: [],
      /** Max chunks before dropping oldest (supports ~20 min of 1-sec chunks) */
      maxTranslatedChunks: 2000,
      /** Total bytes in translatedChunks — used to enforce byte cap */
      translatedChunksSize: 0,
      onActivityChange: null,
      userSpeakingCount: 0,
      totalAudioSent: 0,
      totalAudioReceived: 0,
      /** Flash model: accumulate audio parts until turnComplete */
      flashModelAudioParts: [],
      /** Timeout to clear flashModelAudioParts if turnComplete stalls */
      flashModelPartsTimer: null,
      /** Streaming: raw PCM buffer accumulated from incoming audio parts (played before turnComplete) */
      streamingBuffer: Buffer.alloc(0),
      /** Map of userId → { pcmBuffer, flushTimer } for active real-time streams */
      activeStreams: new Map(),
      /** Interval ID for periodic activity check */
      activityCheckInterval: null,
      /** Interval ID for voice keep-alive (prevents Discord from dropping idle connections) */
      keepAliveInterval: null,
      /** Reference to voiceStateUpdate listener (removed during stopTranslation) */
      voiceStateHandler: null,
      /** Audio send queue — serializes concurrent sends to the single Gemini WebSocket */
      audioSendQueue: [],
      /** Whether a send is currently in progress (queue processing flag) */
      isSendingAudio: false,
      /** Interval ID for subscription sweep */
      subscriptionSweepInterval: null,
      /** Timeout ID for playback drain timer */
      playbackDrainTimer: null,
      /** Map of userId → recovery timer timeout ID */
      recoveryTimers: new Map(),
      /** Map of userId → recovery attempt count */
      recoveryAttempts: new Map(),
      /** Free usage tracking for non-premium servers */
      remainingMinutes,
      freeUsageAutoStopTimer: null,
      freeUsageWarningTimer: null,
      /** Counter for gating verbose per-message Gemini debug logs (prevents log flooding) */
      geminiMessageCount: 0,
    };

    // Subscribe audio player to connection
    connection.subscribe(state.audioPlayer);

    // Connect persistent Gemini Live WebSocket session
    log.info('🔌 Connecting Gemini Live session...');
    await connectGeminiSession(state);

    // Set up real-time audio pipeline
    log.info('🎧 Setting up real-time audio pipeline (streaming PCM chunks every 200ms)...');
    setupRealtimeAudioPipeline(state);

    // Start activity monitor — checks if channel is empty for 10+ min and stops if so
    state.activityCheckInterval = setInterval(async () => {
      if (!state.isRunning) return;
      const inactiveTime = Date.now() - state.lastActivityTime;
      try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;
        const channel = guild.channels.cache.get(state.voiceChannelId);
        if (!channel || channel.type !== 2) return;
        const humanMembers = channel.members.filter(m => !m.user.bot).size;
        
        if (humanMembers === 0 && inactiveTime > 10 * 60 * 1000) {
          log.warn(`⏰ Channel empty for ${Math.round(inactiveTime / 60000)} min — stopping translation`);
          await stopTranslation(guildId, client);
        } else if (humanMembers > 0 && inactiveTime > 25 * 60 * 1000) {
          log.info(`💤 ${humanMembers} user(s) in channel but inactive for ${Math.round(inactiveTime / 60000)} min — keeping alive`);
        }

        // Memory health check — log warnings when translated audio buffer grows large
        const bufMB = (state.translatedChunksSize || 0) / (1024 * 1024);
        if (bufMB > 1.5) {
          log.warn(`🧠 Large audio buffer: ${bufMB.toFixed(1)} MB (${state.translatedChunks.length} chunks) — may indicate playback lag`);
        } else if (bufMB > 0.5 && state.translatedChunks.length > 5) {
          log.info(`🧠 Audio buffer: ${bufMB.toFixed(1)} MB (${state.translatedChunks.length} chunks)`);
        }
      } catch (e) { /* ignore monitor errors */ }
    }, 60000); // check every 60 seconds

    // Start voice keep-alive — sends silence every 45s to prevent Discord gateway from dropping idle connections
    const silenceFrame = Buffer.alloc(960 * 2 * 2); // 20ms stereo silence at 48kHz 16-bit PCM
    state.keepAliveInterval = setInterval(() => {
      if (!state.isRunning || !state.connection) return;
      // Only send keep-alive if audio player is idle AND no translation chunks are queued
      // (prevents silence from taking over the player between translation chunks)
      if (state.audioPlayer.state.status === AudioPlayerStatus.Idle && state.translatedChunks.length === 0) {
        try {
          const resource = createAudioResource(Readable.from([silenceFrame]), { inputType: StreamType.Raw });
          state.audioPlayer.play(resource);
        } catch (e) { /* ignore keep-alive errors */ }
      }
    }, 45000);

    // Store connection state
    activeConnections.set(guildId, state);

    // Set session timeout (6 hours)
    state.sessionTimeout = setTimeout(async () => {
      log.warn(`⏰ Session timeout reached (${SESSION_MAX_DURATION_MS / 3600000}h) — stopping translation`);
      await stopTranslation(guildId, client);
    }, SESSION_MAX_DURATION_MS);

    // Free usage timers for non-premium servers
    if (remainingMinutes !== null && remainingMinutes > 0) {
      const ONE_MINUTE_MS = 60 * 1000;
      const WARNING_THRESHOLD = 10;

      // Warning timer — 10 minutes before limit (or immediately if < 10 min remaining)
      const warningDelay = remainingMinutes > WARNING_THRESHOLD
        ? (remainingMinutes - WARNING_THRESHOLD) * ONE_MINUTE_MS
        : 0;

      if (warningDelay === 0) {
        // Less than 10 min remaining — send warning immediately
        setTimeout(() => {
          sendFreeUsageWarning(guildId, client, remainingMinutes);
        }, 5000);
      } else {
        state.freeUsageWarningTimer = setTimeout(() => {
          sendFreeUsageWarning(guildId, client, WARNING_THRESHOLD);
        }, warningDelay);
      }

      // Auto-stop timer — when free minutes run out
      state.freeUsageAutoStopTimer = setTimeout(async () => {
        log.warn(`⏰ Free usage limit reached (${remainingMinutes} min) — auto-stopping translation`);
        const channel = client.guilds.cache.get(guildId)?.channels.cache.get(state.voiceChannelId);
        if (channel) {
          const limitEmbed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('⏰ Free Limit Reached')
            .setDescription(
              `Voice Call Translation has been **automatically stopped**.\n\n` +
              `You've used all **${FREE_DAILY_LIMIT_MINUTES} free minutes** for today.\n` +
              'Come back tomorrow or [go premium](https://www.patreon.com/c/tsio/membership) for unlimited access.'
            )
            .setTimestamp();
          try {
            await channel.send({ embeds: [limitEmbed] });
          } catch (e) { /* ignore send errors */ }
        }
        await stopTranslation(guildId, client);
      }, remainingMinutes * ONE_MINUTE_MS);
    }

    // Handle connection state changes with detailed logging
    connection.on(VoiceConnectionStatus.Connecting, () => {
      log.info('🔄 Voice connection is connecting...');
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      log.success('🔊 Voice connection ready');
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      log.warn('⚠️ Voice connection disconnected — attempting reconnect with retries...');
      
      for (let attempt = 1; attempt <= VOICE_RECONNECT_MAX_ATTEMPTS; attempt++) {
        const delay = attempt === 1 ? VOICE_RECONNECT_WAIT_MS : VOICE_RECONNECT_WAIT_MS * Math.pow(2, attempt - 2);
        log.info(`🔄 Reconnect attempt ${attempt}/${VOICE_RECONNECT_MAX_ATTEMPTS} (${delay}ms delay)...`);
        
        try {
          await new Promise(resolve => setTimeout(resolve, Math.max(1, delay)));
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Ready, 5000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
          log.success('✅ Voice connection reconnected on attempt ' + attempt);
          // Rebuild per-user receive streams after reconnect
          ensureVoiceChannelSubscriptions(state);
          return;
        } catch (e) {
          log.warn(`⚠️ Reconnect attempt ${attempt} failed: ${e.message}`);
        }
      }
      
      // All retries exhausted — check if users are still in the channel
      log.warn('👥 Checking for users in voice channel for potential auto-restart...');
      try {
        const guild = await client.guilds.fetch(guildId);
        const channel = guild.channels.cache.get(state?.voiceChannelId || voiceChannelId);
        if (channel && channel.type === 2) {
          const humanMembers = channel.members.filter(m => !m.user.bot).size;
          if (humanMembers > 0 && state?.isRunning) {
            log.info(`👥 ${humanMembers} user(s) still in channel — auto-restarting translation`);
            // Mark old state as dead so cleanup doesn't conflict
            if (state) {
              state.isRunning = false;
              activeConnections.delete(guildId);
            }
            // Brief pause for Discord to fully release old connection
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Re-fetch settings from DB and restart
            try {
              const settings = await VoiceCallTranslation.findOne({ guildId });
              if (settings && settings.enabled) {
                const result = await startTranslation(
                  guildId,
                  settings.voiceChannelId || state?.voiceChannelId || voiceChannelId,
                  settings.sourceLanguage || state?.sourceLanguage || 'auto',
                  settings.targetLanguage || state?.targetLanguage,
                  settings.model || state?.modelId || DEFAULT_MODEL,
                  client || state?.client,
                  settings.voice || state?.voiceName || DEFAULT_VOICE
                );
                if (result.success) {
                  log.success('✅ Voice translation auto-restarted successfully');
                  // Notify text channel if possible
                  try {
                    const guildChannels = guild.channels.cache;
                    const textChannel = guildChannels.find(c => c.type === 0 && c.name.includes('general'));
                    if (textChannel) {
                      textChannel.send('🔄 Voice translation reconnected!').catch(() => {});
                    }
                  } catch (notifyErr) { /* ignore notification errors */ }
                  return;
                }
              }
            } catch (restartErr) {
              log.error(`❌ Auto-restart failed: ${restartErr.message}`);
            }
          } else {
            log.info('👥 No users in channel — stopping translation');
          }
        }
      } catch (e) {
        log.error(`❌ Error checking channel users: ${e.message}`);
      }
      
      log.warn('⏹️ All reconnect attempts exhausted — stopping translation');
      await stopTranslation(guildId, client || state?.client);
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

    // Listen for users joining/leaving the voice channel to subscribe/unsubscribe proactively
    const voiceStateHandler = async (oldState, newState) => {
      // Only care about this guild
      if (oldState.guild.id !== guildId && newState.guild.id !== guildId) return;
      const targetChannelId = state.voiceChannelId;

      // User joined the VCT channel
      if (newState.channelId === targetChannelId && oldState.channelId !== targetChannelId) {
        if (!newState.member?.user?.bot) {
          log.info(`👤 User joined voice channel: ${newState.member?.user?.username || newState.id}`);
          setupUserStream(state, newState.id);
        }
      }

      // User left the VCT channel — clean up their stream
      if (oldState.channelId === targetChannelId && newState.channelId !== targetChannelId) {
        if (!oldState.member?.user?.bot) {
          log.info(`👋 User left voice channel: ${oldState.member?.user?.username || oldState.id}`);
          clearUserStream(state, oldState.id, log);
        }
      }
    };

    client.on('voiceStateUpdate', voiceStateHandler);
    state.voiceStateHandler = voiceStateHandler;
    log.info('✅ Voice state listener registered — will subscribe new joiners automatically');

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

// ==============================
// Durable Per-User Stream Management
// ==============================

/**
 * Check if a user is still in the target voice channel.
 */
function isUserInTargetVoiceChannel(state, userId) {
  try {
    const guild = state.client.guilds.cache.get(state.guildId);
    if (!guild) return false;
    const channel = guild.channels.cache.get(state.voiceChannelId);
    if (!channel || channel.type !== 2) return false;
    return channel.members.has(userId);
  } catch (e) {
    return false;
  }
}

/**
 * Clean up a user's stream state without triggering recovery.
 */
function clearUserStream(state, userId, log) {
  const info = state.activeStreams.get(userId);
  if (!info) return;
  if (info.flushInterval) clearInterval(info.flushInterval);
  try { info.decoder?.destroy(); } catch (e) { /* ignore */ }
  try { info.audioStream?.destroy(); } catch (e) { /* ignore */ }
  // Cleanup VAD instance
  if (info.userVAD) {
    info.userVAD.destroy().catch(() => {});
    info.userVAD = null;
  }
  state.activeStreams.delete(userId);
  if (log) log.debug(`🧹 Cleaned stream for ${info.username || userId}`);
}

/**
 * Schedule automatic re-subscription for a user after stream ends or decoder error.
 */
function scheduleUserStreamRecovery(state, userId, reason) {
  const log = getLogger(state.guildId);
  const info = state.activeStreams.get(userId);
  const username = info?.username || userId;

  if (!state.isRunning) return;
  if (!isUserInTargetVoiceChannel(state, userId)) {
    state.recoveryAttempts.delete(userId);
    return;
  }

  const attempts = (state.recoveryAttempts.get(userId) || 0) + 1;
  if (attempts > MAX_STREAM_RECOVERY_ATTEMPTS) {
    log.warn(`⚠️ ${username}: Gave up re-subscribing after ${attempts} attempts (reason: ${reason})`);
    state.recoveryAttempts.delete(userId);
    return;
  }
  state.recoveryAttempts.set(userId, attempts);

  const existingTimer = state.recoveryTimers.get(userId);
  if (existingTimer) clearTimeout(existingTimer);

  log.info(`🔄 ${username}: Re-subscribe in ${STREAM_RECOVERY_DELAY_MS}ms (attempt ${attempts}, reason: ${reason})`);

  const timer = setTimeout(() => {
    state.recoveryTimers.delete(userId);
    if (!state.isRunning) return;
    if (!isUserInTargetVoiceChannel(state, userId)) return;
    if (state.activeStreams.has(userId)) return;
    setupUserStream(state, userId, `recovery-${attempts}`);
  }, STREAM_RECOVERY_DELAY_MS);

  state.recoveryTimers.set(userId, timer);
}

/**
 * Subscribe to all non-bot users currently in the voice channel.
 * Called periodically and after reconnects to self-heal subscriptions.
 */
function ensureVoiceChannelSubscriptions(state) {
  const log = getLogger(state.guildId);
  if (!state.isRunning) return;

  try {
    const guild = state.client.guilds.cache.get(state.guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(state.voiceChannelId);
    if (!channel || channel.type !== 2) return;

    const members = channel.members.filter(m => !m.user.bot);
    for (const [userId, member] of members) {
      if (!state.activeStreams.has(userId)) {
        log.debug(`🔍 Sweep: subscribing ${member.user.username} (${userId})`);
        setupUserStream(state, userId, 'sweep');
      }
    }

    for (const [userId, streamInfo] of state.activeStreams) {
      if (!channel.members.has(userId)) {
        log.debug(`🔍 Sweep: cleaning up ${streamInfo.username || userId} (left channel)`);
        clearUserStream(state, userId, log);
      }
    }
  } catch (e) { /* ignore sweep errors */ }
}

/**
 * Append a short silence tail to prevent Opus interpolation artifacts.
 */
function appendSilenceTail(stereoBuffer) {
  const silenceSamples = Math.floor(PCM_SAMPLE_RATE * 2 * (SILENCE_TAIL_MS / 1000));
  const tail = Buffer.alloc(silenceSamples * 2);
  return Buffer.concat([stereoBuffer, tail]);
}

/**
 * Check if a user ID belongs to a bot (including this bot).
 *
 * Order of checks (fastest → slowest):
 * 1. This bot's own user ID
 * 2. Member cache of the target voice channel
 * 3. Global user cache
 * 4. API fetch (rare fallback — e.g. member/user not cached)
 *
 * @param {Object} state - The guild's voice call translation state
 * @param {string} userId - Discord user ID to check
 * @returns {Promise<boolean>} - True if the user is a bot
 */
async function isBotUser(state, userId) {
  if (!userId) return true;
  // Fast path: this bot itself
  if (state.client?.user?.id === userId) return true;

  // Fast path: cached member in the voice channel
  try {
    const member = state.client.guilds.cache
      .get(state.guildId)?.channels?.cache
      .get(state.voiceChannelId)?.members?.get(userId);
    if (member) return member.user.bot === true;
  } catch (e) { /* fall through to cache/fetch */ }

  // Fast path: cached user
  const cached = state.client.users.cache.get(userId);
  if (cached) return cached.bot === true;

  // Slow path: API fetch (only when not cached)
  try {
    const user = await state.client.users.fetch(userId);
    return user.bot === true;
  } catch (e) {
    // Can't determine — assume human so we don't drop real speakers
    return false;
  }
}

/**
 * Set up a full audio pipeline for a single user: subscribe → decode Opus → accumulate PCM → send to Gemini on silence.
 * Called proactively for all users in channel on join, and when new users join.
 * Also triggered by speaking.start as a fallback.
 *
 * BEHAVIOR:
 * - Turn-based (3.1 Flash, 2.5 Native): batch mode — accumulate FULL utterance, send on silence
 *
 * @param {Object} state - The guild's voice call translation state
 * @param {string} userId - Discord user ID to subscribe to
 * @param {string} source - Where this subscription came from (direct, sweep, recovery-N, voiceStateUpdate)
 */
async function setupUserStream(state, userId, source = 'direct') {
  const log = getLogger(state.guildId);
  const receiver = state.connection?.receiver;
  if (!receiver) return;

  if (state.activeStreams.has(userId)) return;
  if (!state.isRunning) return;

  // NEVER subscribe to bots — this bot never hears itself or other bots.
  // This guard covers ALL entry paths (speaking.start, sweep, voice joins, recovery),
  // preventing translating bot audio and infinite loops between translator bots.
  if (await isBotUser(state, userId)) {
    log.debug(`🤖 Skipping bot user ${userId} (source: ${source})`);
    return;
  }

  const user = state.client.users.cache.get(userId);
  const username = user?.username || userId;

  // Reset recovery attempts on successful subscribe
  state.recoveryAttempts.set(userId, 0);

  const silenceDuration = FLASH_SILENCE_DURATION_MS;
  const audioStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: silenceDuration,
    },
  });

  const decoder = createOpusDecoder();
  decoder.on('error', (err) => {
    // DAVE epoch transitions can cause transient decoder errors — don't destroy the stream
    if (err?.message?.includes('DAVE') || err?.message?.includes('decrypt')) {
      log.debug(`🔒 DAVE/decrypt transient error for ${username}: ${err.message}`);
      return;
    }
    log.warn(`⚠️ Opus decoder error for ${username}: ${err.message} — scheduling recovery`);
    clearUserStream(state, userId, log);
    scheduleUserStreamRecovery(state, userId, `decoder-error: ${err.message}`);
  });

  const streamInfo = {
    decoder,
    totalBytes: 0,
    audioStream,
    pcmChunks: [],
    username,
    flushInterval: null,
    lastFlushIndex: 0,
    subscribedAt: Date.now(),
    subscribeSource: source,
    utteranceCount: 0,
    /** Silero VAD instance for this user */
    userVAD: null,
    /** Track speech probability for current chunk */
    lastSpeechProbability: 0,
    /** Count consecutive noise frames (no speech) */
    consecutiveNoiseFrames: 0,
    /** Track if any speech was detected in current utterance */
    hasSpeechBeenDetected: false,
  };
  state.activeStreams.set(userId, streamInfo);

  // Create per-user Silero VAD instance
  try {
    streamInfo.userVAD = await createUserVAD(userId, username);
    log.debug(`🎤 VAD initialized for ${username}`);
  } catch (vadErr) {
    log.warn(`⚠️ VAD init failed for ${username}: ${vadErr.message} — proceeding without VAD`);
  }

  const pcmStream = audioStream.pipe(decoder);
  const pcmChunks = streamInfo.pcmChunks;
  let totalBytes = 0;

  pcmStream.on('data', (chunk) => {
    pcmChunks.push(chunk);
    totalBytes += chunk.length;
    state.lastActivityTime = Date.now();
  });

  // Turn-based mode: periodic force-flush prevents PCM buffer bloat on long speech
  // Also runs VAD to track speech state for filtering the final utterance
  streamInfo.flushInterval = setInterval(async () => {
    if (pcmChunks.length > streamInfo.lastFlushIndex && state.geminiSession && state.isRunning) {
      const newChunks = pcmChunks.slice(streamInfo.lastFlushIndex);
      streamInfo.lastFlushIndex = pcmChunks.length;
      const buffer = Buffer.concat(newChunks);
      const durationMs = Math.round((buffer.length / 2) / PCM_SAMPLE_RATE * 1000);
      log.debug(`⏰ ${username}: Force-flushing ${(buffer.length / 1024).toFixed(1)} KB (${durationMs}ms)`);
      // Prune old chunks to prevent unbounded growth
      if (streamInfo.lastFlushIndex > 20) {
        pcmChunks.splice(0, streamInfo.lastFlushIndex);
        streamInfo.lastFlushIndex = pcmChunks.length;
      }
      const downsampled = downsamplePcm(buffer, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
      if (downsampled.length > 0) {
        // Run VAD on this chunk to track speech state
        if (streamInfo.userVAD) {
          try {
            const vadResult = await streamInfo.userVAD.processChunk(downsampled);
            streamInfo.lastSpeechProbability = vadResult.probability;
            
            // Log VAD debug info for first few frames
            if (streamInfo.consecutiveNoiseFrames < 5 || vadResult.isSpeech) {
              const dbg = vadResult.debug || {};
              log.debug(`📊 ${username}: VAD rms=${dbg.rms?.toFixed(6) || 'N/A'} peak=${dbg.peakAmplitude?.toFixed(6) || 'N/A'} speech=${vadResult.isSpeech} frames=${dbg.samplesProcessed} chunk=${(downsampled.length / 1024).toFixed(1)}KB`);
            }
            
            if (vadResult.isSpeech || vadResult.hadSpeechThisChunk) {
              streamInfo.hasSpeechBeenDetected = true;
              streamInfo.consecutiveNoiseFrames = 0;
            } else {
              streamInfo.consecutiveNoiseFrames++;
            }
          } catch (vadErr) {
            // VAD error — continue without filtering
          }
        }
        sendChunkToGemini(state, downsampled).catch((err) => {
          log.warn(`⚠️ ${username}: Force-flush send error: ${err.message}`);
        });
      }
    }
  }, TURN_BASED_FLUSH_INTERVAL_MS);

  pcmStream.on('end', async () => {
    const info = state.activeStreams.get(userId);

    if (info?.flushInterval) {
      clearInterval(info.flushInterval);
      info.flushInterval = null;
    }

    if (info) {
      try { info.decoder.destroy(); } catch (e) { /* ignore */ }
      state.activeStreams.delete(userId);
    }

    // Input diagnostics: no PCM data at all
    if (pcmChunks.length === 0 || totalBytes === 0) {
      log.warn(`🔇 ${username}: Speech ended but NO PCM received — likely Discord client input/VAD/mic issue (source: ${streamInfo.subscribeSource})`);
      // Cleanup VAD
      if (streamInfo.userVAD) {
        await streamInfo.userVAD.destroy().catch(() => {});
        streamInfo.userVAD = null;
      }
      scheduleUserStreamRecovery(state, userId, 'empty-audio');
      return;
    }

    if (!state.geminiSession || !state.isRunning) {
      const durationMs = Math.round((totalBytes / 2) / PCM_SAMPLE_RATE * 1000);
      log.debug(`⏹️ ${username}: Speech ended — skipped (${(totalBytes / 1024).toFixed(1)} KB, ${durationMs}ms) — no active session`);
      // Cleanup VAD
      if (streamInfo.userVAD) {
        await streamInfo.userVAD.destroy().catch(() => {});
        streamInfo.userVAD = null;
      }
      return;
    }

    const startIndex = info?.lastFlushIndex || 0;
    if (startIndex >= pcmChunks.length) {
      log.debug(`⏹️ ${username}: No new audio since last stream flush — skipping final send`);
      // Cleanup VAD
      if (streamInfo.userVAD) {
        await streamInfo.userVAD.destroy().catch(() => {});
        streamInfo.userVAD = null;
      }
      return;
    }

    const finalChunks = pcmChunks.slice(startIndex);
    const fullUtterance = Buffer.concat(finalChunks);
    const durationMs = Math.round((fullUtterance.length / 2) / PCM_SAMPLE_RATE * 1000);

    if (durationMs < 200) {
      log.debug(`⏹️ ${username}: Speech too short (${durationMs}ms), skipping`);
      // Cleanup VAD instance
      if (streamInfo.userVAD) {
        await streamInfo.userVAD.destroy().catch(() => {});
        streamInfo.userVAD = null;
      }
      return;
    }

    // === Downsample once, reuse for both VAD and Gemini ===
    const downsampled = downsamplePcm(fullUtterance, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
    if (downsampled.length === 0) {
      log.warn(`⚠️ ${username}: Downsampled audio empty, skipping`);
      if (streamInfo.userVAD) {
        await streamInfo.userVAD.destroy().catch(() => {});
        streamInfo.userVAD = null;
      }
      return;
    }

    // === Run VAD on the full accumulated utterance ===
    // In turn-based mode, the 30s flushInterval may never fire before the stream ends,
    // so VAD hasn't processed any audio yet. Run it now on the complete utterance.
    if (streamInfo.userVAD && !streamInfo.hasSpeechBeenDetected) {
      try {
        // Feed audio to VAD in chunks to simulate real-time processing
        const CHUNK_SIZE = GEMINI_INPUT_RATE * 2; // 1 second of 16kHz audio = 32000 bytes
        for (let offset = 0; offset < downsampled.length; offset += CHUNK_SIZE) {
          const chunk = downsampled.subarray(offset, Math.min(offset + CHUNK_SIZE, downsampled.length));
          const vadResult = streamInfo.userVAD.processChunk(chunk);
          if (vadResult.isSpeech || vadResult.hadSpeechThisChunk) {
            streamInfo.hasSpeechBeenDetected = true;
            log.debug(`🎤 ${username}: VAD detected speech in final utterance (rms=${vadResult.rms?.toFixed(6)}, frames: speech=${vadResult.totalSpeechFrames}, noise=${vadResult.totalNoiseFrames})`);
            break;
          }
        }
        if (!streamInfo.hasSpeechBeenDetected) {
          log.debug(`🔇 ${username}: VAD scan found no speech in ${durationMs}ms utterance (all frames below threshold)`);
        }
      } catch (vadErr) {
        log.debug(`⚠️ ${username}: VAD scan error: ${vadErr.message} — sending anyway`);
        streamInfo.hasSpeechBeenDetected = true;
      }
    }

    // Cleanup VAD instance
    if (streamInfo.userVAD) {
      await streamInfo.userVAD.destroy().catch(() => {});
      streamInfo.userVAD = null;
    }

    // === VAD FILTER: Skip utterance if no speech was detected ===
    if (!streamInfo.hasSpeechBeenDetected) {
      log.debug(`🔇 ${username}: Utterance skipped — no speech detected by VAD (${(fullUtterance.length / 1024).toFixed(1)} KB, ${durationMs}ms, noise-only)`);
      return;
    }

    streamInfo.utteranceCount++;
    log.info(`⏹️ ${username}: Utterance #${streamInfo.utteranceCount} ended — ${(fullUtterance.length / 1024).toFixed(1)} KB PCM, ${durationMs}ms (source: ${streamInfo.subscribeSource})`);

    try {
      // Turn-based mode: send full utterance + silence tail — model's internal VAD detects silence and responds
      const SILENCE_TAIL_SAMPLES = GEMINI_INPUT_RATE; // 1 second of silence at 16kHz
      const silenceTail = Buffer.alloc(SILENCE_TAIL_SAMPLES * 2); // 16-bit PCM = 2 bytes/sample
      const audioWithSilence = Buffer.concat([downsampled, silenceTail]);
      await sendChunkToGemini(state, audioWithSilence);
      log.success(`📤 Sent utterance to Gemini (${(downsampled.length / 1024).toFixed(1)} KB, ${durationMs}ms + 1s silence tail)`);
    } catch (err) {
      log.error(`❌ Failed to send utterance to Gemini: ${err.message}`);
    } finally {
      // Free PCM data immediately to help GC — utterance is fully processed
      pcmChunks.length = 0;
    }
  });

  audioStream.on('error', (err) => {
    // DAVE epoch transitions can cause transient stream errors — don't destroy the stream
    if (err?.message?.includes('DAVE') || err?.message?.includes('decrypt')) {
      log.debug(`🔒 DAVE/decrypt transient stream error for ${username}: ${err.message}`);
      return;
    }
    log.error(`❌ Audio stream error for ${username}: ${err.message}`);
    clearUserStream(state, userId, log);
    scheduleUserStreamRecovery(state, userId, `stream-error: ${err.message}`);
  });

  pcmStream.on('error', (err) => {
    // DAVE epoch transitions can cause transient PCM errors — don't destroy the stream
    if (err?.message?.includes('DAVE') || err?.message?.includes('decrypt')) {
      log.debug(`🔒 DAVE/decrypt transient PCM error for ${username}: ${err.message}`);
      return;
    }
    log.error(`❌ PCM stream error for ${username}: ${err.message}`);
    clearUserStream(state, userId, log);
    scheduleUserStreamRecovery(state, userId, `pcm-error: ${err.message}`);
  });

  log.info(`🎧 Subscribed to ${username} (${userId}) [${streamInfo.subscribeSource}] ${streamInfo.userVAD ? '(VAD enabled)' : '(VAD disabled)'}`);
}

/**
 * Set up the real-time audio pipeline.
 *
 * KEY DESIGN:
 * - Turn-based models (3.1 Flash, 2.5 Native): batch mode — accumulate FULL utterance, send on silence.
 *   Gemini receives a complete sentence → produces a coherent translation.
 *   Speech ends after 1.5s of silence (EndBehaviorType.AfterSilence).
 */
function setupRealtimeAudioPipeline(state) {
  const log = getLogger(state.guildId);
  const receiver = state.connection.receiver;

  log.info(`🔍 Listening for speakers in voice channel (batch mode)...`);

  /**
   * BATCH MODE: Accumulate the ENTIRE utterance, then send to Gemini at once.
   * Gemini receives a complete sentence → produces a coherent translation.
   * Speech ends after 1.5s of silence (EndBehaviorType.AfterSilence).
   */
  // Listen for speaking start — triggers subscription (proactive setup below covers existing users)
  receiver.speaking.on('start', (userId) => {
    if (userId === state.client.user.id) return;
    // If user already subscribed via proactive setup, this is a no-op
    setupUserStream(state, userId);
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
    if (state.translatedChunks.length > 0) {
      playNextChunk(state);
    }
  });

  state.audioPlayer.on('error', (error) => {
    log.error(`❌ Audio player error: ${error.message}`);
    if (state.translatedChunks.length > 0) {
      setTimeout(() => {
        if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
          playNextChunk(state);
        }
      }, 100);
    }
  });

  log.success(`✅ Audio pipeline ready — batch mode (full utterance → Gemini → translation)`);

  // Proactively subscribe to ALL users currently in the voice channel
  ensureVoiceChannelSubscriptions(state);

  // Start periodic subscription sweep — self-heals missed subscriptions
  state.subscriptionSweepInterval = setInterval(() => {
    ensureVoiceChannelSubscriptions(state);
  }, SUBSCRIPTION_SWEEP_INTERVAL_MS);
}

/**
 * Build a system instruction for bidirectional translation between two languages.
 * Works for ALL models (Flash Live, Native Audio).
 */
function buildTranslationSystemInstruction(sourceLanguage, targetLanguage) {
  const lang1 = getLanguageName(sourceLanguage);
  const lang2 = getLanguageName(targetLanguage);
  return [
    `You have to understand the user voice message meaning as a native speaker of that language, and translate it to the other language return same meaning that the speaker meant to say because the words have different meanings in different languages so u have to understand what user wanted to say and return complete proper grammar sentence.`,
    `You are a native speaker of both ${lang1} and ${lang2}. You are a translator. Your ONLY output is a spoken translation in the target language of whatever the speaker says. Speak in a natural, fluent, and native style. Do NOT add any commentary, explanations, or text. Do NOT repeat the original text. Do NOT add your own thoughts or questions. Do NOT output any text — only audio translation.`,
    `You MUST translate bidirectionally between ${lang1} and ${lang2}.`,
    `If the speaker is speaking in ${lang1}, output ONLY the ${lang2} translation. If the speaker is speaking in ${lang2}, output ONLY the ${lang1} translation. Dont output same language translation.`,
    `You must auto-detect which language is being spoken by the speaker, don't return the same language, and always translate to the other language.`,
    `Before responding, identify the language of what you just heard. If it is the same as your planned output language, you made a mistake — switch to the other language.`,
    ``,
    `ABSOLUTE RULES - VIOLATION BREAKS THE SERVICE:`,
    `- NEVER add greetings, explanations, or any text.`,
    `- NEVER say "I understand", "Here is", "The speaker said", "In other words", or similar.`,
    `- NEVER add your own thoughts, questions, or comments.`,
    `- NEVER repeat the original text back.`,
    `- If unsure, translate as best you can, output ONLY that. No disclaimers.`,
    `Your job is to translate speech to speech, nothing else.`,
  ].join('\n');
}

/**
 * Build the config for gemini-3.1-flash-live-preview.
 * This model uses speechConfig + contextWindowCompression + systemInstruction.
 * It listens, detects silence, and returns translated audio as a turn.
 */
function buildFlashLiveConfig(state, systemInstruction) {
  const voiceName = state.voiceName || 'Zephyr';
  return {
    responseModalities: ['AUDIO'],
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    temperature: 0.0,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    },
    thinkingConfig: {
      thinkingLevel: 'low',
    },
    contextWindowCompression: {
      triggerTokens: '104857',
      slidingWindow: { targetTokens: '52428' },
    },
  };
}

/**
 * Build the config for gemini-2.5-flash-native-audio-preview.
 * Native audio model — batch mode with speechConfig, mediaResolution, context compression, systemInstruction.
 * Uses system instruction for translation-only behavior.
 */
function buildNativeAudioConfig(state, systemInstruction) {
  const voiceName = state.voiceName || 'Aoede';
  return {
    responseModalities: ['AUDIO'],
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    temperature: 0.0,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    },
    thinkingConfig: {
      thinkingBudget: 2048,
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

  log.info(`🔌 Opening Gemini Live WebSocket session for model: ${state.modelId}...`);

  const genAI = getGenAIClient();

  // Build the system instruction for bidirectional translation
  const systemInstruction = buildTranslationSystemInstruction(
    state.sourceLanguage, state.targetLanguage
  );

  // Build config based on model type (system instruction embedded at config level)
  let config;
  if (isNativeAudio) {
    config = buildNativeAudioConfig(state, systemInstruction);
    log.info(`📖 Using Native Audio config (voice: ${state.voiceName || 'Aoede'})`);
  } else {
    config = buildFlashLiveConfig(state, systemInstruction);
    log.info(`📖 Using Flash Live config (voice: ${state.voiceName || 'Zephyr'})`);
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
          // Gate verbose per-message logging to prevent console flooding.
          // With thinking enabled, Gemini streams many serverContent messages;
          // log the first few, then summarize every 100th so the log stays readable
          // while still surfacing unusual message types (toolCall, turnComplete) immediately.
          state.geminiMessageCount = (state.geminiMessageCount || 0) + 1;
          const msgType = message?.serverContent ? 'serverContent' : message?.toolCall ? 'toolCall' : message?.setupComplete ? 'setupComplete' : 'other';
          const isUnusualType = msgType !== 'serverContent' || !!message?.serverContent?.turnComplete;
          if (state.geminiMessageCount <= 3 || isUnusualType || state.geminiMessageCount % 100 === 0) {
            log.debug(`📨 Gemini message (#${state.geminiMessageCount}): type=${msgType} keys=${Object.keys(message || {}).join(',')}`);
          }

          // Streaming mode: process each audio part immediately instead of batching at turnComplete
          const modelTurn = message?.serverContent?.modelTurn;
          if (modelTurn?.parts) {
            for (const part of modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData?.data) {
                // Decode base64 → raw PCM and accumulate in streaming buffer
                const pcmData = Buffer.from(part.inlineData.data, 'base64');
                state.streamingBuffer = Buffer.concat([state.streamingBuffer, pcmData]);

                // Stream as soon as we have enough for a playback chunk
                while (state.streamingBuffer.length >= MIN_STREAMING_BUFFER_BYTES) {
                  const chunk = state.streamingBuffer.subarray(0, MIN_STREAMING_BUFFER_BYTES);
                  state.streamingBuffer = state.streamingBuffer.subarray(MIN_STREAMING_BUFFER_BYTES);

                  state.translatedChunks.push(chunk);
                  state.translatedChunksSize += chunk.length;

                  // Cap chunks to prevent unbounded growth
                  while (state.translatedChunks.length > state.maxTranslatedChunks || state.translatedChunksSize > MAX_BUFFER_SIZE) {
                    const oldest = state.translatedChunks.shift();
                    if (oldest) state.translatedChunksSize -= oldest.length;
                  }

                  // Start playing immediately if idle
                  if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
                    log.debug(`▶️ Streaming: playing chunk immediately`);
                    playNextChunk(state);
                  }
                }

                // Reset timeout — if turnComplete doesn't arrive in 180s, log warning
                if (state.flashModelPartsTimer) clearTimeout(state.flashModelPartsTimer);
                state.flashModelPartsTimer = setTimeout(() => {
                  if (state.streamingBuffer.length > 0 || state.flashModelAudioParts.length > 0) {
                    log.warn(`⚠️ Gemini audio parts stale (${state.flashModelAudioParts.length} parts + ${(state.streamingBuffer.length / 1024).toFixed(1)} KB buffer, 180s timeout)`);
                  }
                }, 180000);
              }
              // Log any text parts for debugging
              if (part.text) {
                log.debug(`📝 Turn-based model text: ${part.text}`);
              }
            }
          }

          // When turn is complete, flush any remaining streaming buffer
          if (message?.serverContent?.turnComplete) {
            // Clear the timeout — turnComplete arrived
            if (state.flashModelPartsTimer) {
              clearTimeout(state.flashModelPartsTimer);
              state.flashModelPartsTimer = null;
            }

            // Flush any remaining audio in the streaming buffer (below MIN_STREAMING_BUFFER_BYTES)
            if (state.streamingBuffer.length > 0) {
              state.totalAudioReceived += state.streamingBuffer.length;
              const translatedDurationMs = Math.round((state.streamingBuffer.length / 2) / GEMINI_OUTPUT_RATE * 1000);
              log.success(`🔊 Turn complete — flushing ${(state.streamingBuffer.length / 1024).toFixed(1)} KB remaining audio (${translatedDurationMs}ms)`);

              state.translatedChunks.push(state.streamingBuffer);
              state.translatedChunksSize += state.streamingBuffer.length;
              state.streamingBuffer = Buffer.alloc(0);

              // Cap chunks to prevent unbounded growth
              while (state.translatedChunks.length > state.maxTranslatedChunks || state.translatedChunksSize > MAX_BUFFER_SIZE) {
                const oldest = state.translatedChunks.shift();
                if (oldest) state.translatedChunksSize -= oldest.length;
              }

              // Start playing if idle
              if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
                log.info(`▶️ Playing flushed turn-end audio...`);
                playNextChunk(state);
              }
            } else {
              log.success(`🔊 Turn complete — audio was streamed in real-time`);
            }
          }
        } catch (err) {
          log.error(`❌ Error processing Gemini Live response: ${err.message}`);
        }
      },
      onerror: (error) => {
        log.error(`❌ Gemini Live WebSocket error: ${error?.message || JSON.stringify(error)}`);
        state.geminiSession = null;
        // Attempt reconnection if still running (same as onclose)
        if (state.isRunning && !state.isReconnecting) {
          state.isReconnecting = true;
          reconnectGeminiSession(state).catch(() => {});
        }
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

  log.info(`📝 System instruction set: ${getLanguageName(state.sourceLanguage)} ↔ ${getLanguageName(state.targetLanguage)}`);

  const modeLabel = isNativeAudio ? 'Native Audio batch' : 'Flash Live turn-based';
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

    await new Promise(resolve => setTimeout(resolve, Math.max(1, delay)));

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
 * Send audio PCM data to Gemini Live API for translation.
 * Uses a sequential queue to prevent concurrent writes
 * to the single WebSocket session.
 *
 * One full utterance per queue item.
 */
async function sendChunkToGemini(state, pcmBuffer) {
  // Queue to serialize all sends: no concurrent writes to the single Gemini WebSocket
  return new Promise((resolve, reject) => {
    state.audioSendQueue.push({ pcmBuffer, resolve, reject });
    processSendQueue(state);
  });
}

/**
 * Process the audio send queue sequentially — only one send at a time.
 * Called whenever a new item is enqueued, and again after each send completes.
 */
async function processSendQueue(state) {
  if (state.isSendingAudio || state.audioSendQueue.length === 0) return;
  state.isSendingAudio = true;

  while (state.audioSendQueue.length > 0) {
    // Queue backpressure: drop oldest items if queue is too deep
    if (state.audioSendQueue.length > MAX_SEND_QUEUE_ITEMS) {
      const dropped = state.audioSendQueue.shift();
      if (dropped?.reject) dropped.reject(new Error('Queue overflow — dropped stale chunk'));
      continue;
    }

    const item = state.audioSendQueue.shift();
    try {
      await doSendToGemini(state, item.pcmBuffer);
      item.resolve();
    } catch (err) {
      item.reject(err);
    }
  }

  state.isSendingAudio = false;
}

/**
 * Actual low-level send to the Gemini WebSocket session.
 */
async function doSendToGemini(state, pcmBuffer) {
  const log = getLogger(state.guildId);

  try {
    if (!state.geminiSession) {
      log.warn('⚠️ No active Gemini Live session, reconnecting...');
      await connectGeminiSession(state);
    }

    // Boost input volume so Gemini hears quiet speakers clearly (soft-clipped).
    // Applied here — the single choke point for ALL input audio (force-flush
    // and utterance-end both route through doSendToGemini).
    const boosted = INPUT_AUDIO_GAIN && INPUT_AUDIO_GAIN !== 1
      ? amplifyPcm(pcmBuffer, INPUT_AUDIO_GAIN)
      : pcmBuffer;

    const audioBase64 = boosted.toString('base64');

    // Use 'audio' key — NOT 'media' (media causes WebSocket close 1011)
    state.geminiSession.sendRealtimeInput({
      audio: {
        data: audioBase64,
        mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
      },
    });

    state.totalAudioSent += boosted.length;
  } catch (error) {
    log.error(`❌ Gemini Live send error: ${error.message}`);
    state.geminiSession = null;
    if (error.message?.includes('API_KEY') || error.message?.includes('PERMISSION_DENIED')) {
      log.error('🔑 Gemini API key may be invalid or model not available - check your GEMINI_API_KEY');
    }
    throw error;
  }
}

/**
 * Play translated audio through the Discord voice connection.
 * Uses chunked playback with drain timer for stable output.
 */
function playTranslatedAudio(state) {
  const log = getLogger(state.guildId);
  
  // Use chunk-list: compute total buffered length from chunks
  const totalBuffered = state.translatedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const minBufferSize = GEMINI_OUTPUT_RATE * 2 * MIN_PLAYBACK_BUFFER_SECONDS;

  if (totalBuffered < minBufferSize) {
    // Start drain timer — play remaining chunks after short delay if no more audio arrives
    if (!state.playbackDrainTimer) {
      state.playbackDrainTimer = setTimeout(() => {
        state.playbackDrainTimer = null;
        const remaining = state.translatedChunks.reduce((sum, c) => sum + c.length, 0);
        if (remaining > 0 && state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
          log.debug('⏰ Drain timer fired — playing remaining chunks');
          playNextChunk(state);
        }
      }, 100);
    }
    return;
  }

  if (state.playbackDrainTimer) {
    clearTimeout(state.playbackDrainTimer);
    state.playbackDrainTimer = null;
  }

  playNextChunk(state);
}

/**
 * Play the next bounded chunk from translated audio buffer.
 * Chunks are capped at PLAYBACK_CHUNK_SECONDS to prevent large one-shot resources.
 */
function playNextChunk(state) {
  if (state.translatedChunks.length === 0) return;
  if (state.audioPlayer.state.status !== AudioPlayerStatus.Idle) return;

  const log = getLogger(state.guildId);

  try {
    // Concat only the minimum needed for this chunk (at most 1 second of audio)
    const maxChunkBytes = GEMINI_OUTPUT_RATE * 2 * PLAYBACK_CHUNK_SECONDS;
    let chunkBytes = 0;
    let takeCount = 0;
    for (let i = 0; i < state.translatedChunks.length; i++) {
      chunkBytes += state.translatedChunks[i].length;
      takeCount = i + 1;
      if (chunkBytes >= maxChunkBytes) break;
    }

    const spliced = state.translatedChunks.splice(0, takeCount);
    // Update byte tracking — subtract removed chunks
    for (const chunk of spliced) {
      state.translatedChunksSize -= chunk.length;
    }
    const pcmData = Buffer.concat(spliced);

    const upsampledPcm = upsamplePcm(pcmData, GEMINI_OUTPUT_RATE, PCM_SAMPLE_RATE);

    const stereoBuffer = Buffer.alloc(upsampledPcm.length * 2);
    for (let i = 0; i < upsampledPcm.length; i += 2) {
      const sample = upsampledPcm.readInt16LE(i);
      stereoBuffer.writeInt16LE(sample, i * 2);
      stereoBuffer.writeInt16LE(sample, i * 2 + 2);
    }

    // Append silence tail to last chunk to prevent Opus interpolation artifacts
    const finalBuffer = state.translatedChunks.length === 0
      ? appendSilenceTail(stereoBuffer)
      : stereoBuffer;

    const resource = createAudioResource(Readable.from([finalBuffer]), {
      inputType: StreamType.Raw,
    });

    state.audioPlayer.play(resource);
    const remaining = state.translatedChunksSize || 0;
    log.debug(`▶️ Playing ${(chunkBytes / 1024).toFixed(1)} KB chunk (${(remaining / 1024).toFixed(1)} KB remaining)`);
  } catch (error) {
    log.error(`❌ Error playing audio chunk: ${error.message}`);
  }
}

/**
 * Send a free usage warning embed to the voice channel
 */
async function sendFreeUsageWarning(guildId, client, minutesRemaining) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const state = activeConnections.get(guildId);
    if (!state) return;
    const channel = guild.channels.cache.get(state.voiceChannelId);
    if (!channel) return;

    const warningEmbed = new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('⚠️ Free Limit Warning')
      .setDescription(
        `Only **${minutesRemaining} minute(s)** of free Voice Call Translation remaining today.\n` +
        'The bot will auto-stop when the limit is reached.\n\n' +
        '[Go Premium](https://www.patreon.com/c/tsio/membership) for unlimited access.'
      )
      .setTimestamp();

    await channel.send({ embeds: [warningEmbed] });
  } catch (e) { /* ignore send errors */ }
}

/**
 * Record daily usage for free servers
 */
async function recordDailyUsage(guildId, elapsedMinutes) {
  try {
    const VoiceCallTranslation = require('../models/VoiceCallTranslation');
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      [
        {
          $set: {
            dailyUsageDate: {
              $cond: { if: { $ne: ['$dailyUsageDate', today] }, then: today, else: '$dailyUsageDate' }
            },
            dailyMinutesUsed: {
              $cond: { if: { $ne: ['$dailyUsageDate', today] }, then: elapsedMinutes, else: { $add: ['$dailyMinutesUsed', elapsedMinutes] } }
            }
          }
        }
      ],
      { new: true }
    );
  } catch (e) {
    console.error('Failed to record daily VCT usage:', e);
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

    // Clear free usage timers
    if (state.freeUsageAutoStopTimer) {
      clearTimeout(state.freeUsageAutoStopTimer);
      state.freeUsageAutoStopTimer = null;
    }
    if (state.freeUsageWarningTimer) {
      clearTimeout(state.freeUsageWarningTimer);
      state.freeUsageWarningTimer = null;
    }

    // Record daily usage for free servers
    if (state.remainingMinutes !== null && state.startTime) {
      const elapsedMs = Date.now() - state.startTime;
      const elapsedMinutes = Math.max(1, Math.ceil(elapsedMs / 60000));
      await recordDailyUsage(guildId, elapsedMinutes);
    }

    // Clear activity check interval
    if (state.activityCheckInterval) {
      clearInterval(state.activityCheckInterval);
      state.activityCheckInterval = null;
    }

    // Clear keep-alive interval
    if (state.keepAliveInterval) {
      clearInterval(state.keepAliveInterval);
      state.keepAliveInterval = null;
    }

    // Remove voiceStateUpdate listener
    if (state.voiceStateHandler) {
      const c = client || state.client;
      if (c) {
        c.removeListener('voiceStateUpdate', state.voiceStateHandler);
      }
      state.voiceStateHandler = null;
      log.info('🗑️ Voice state listener removed');
    }

    // Flush audio send queue (reject remaining items)
    while (state.audioSendQueue?.length > 0) {
      const item = state.audioSendQueue.shift();
      if (item?.reject) item.reject(new Error('Translation stopped'));
    }
    state.isSendingAudio = false;

    // Clear subscription sweep interval
    if (state.subscriptionSweepInterval) {
      clearInterval(state.subscriptionSweepInterval);
      state.subscriptionSweepInterval = null;
    }

    // Clear playback drain timer
    if (state.playbackDrainTimer) {
      clearTimeout(state.playbackDrainTimer);
      state.playbackDrainTimer = null;
    }

    // Clear flashModelAudioParts timeout
    if (state.flashModelPartsTimer) {
      clearTimeout(state.flashModelPartsTimer);
      state.flashModelPartsTimer = null;
    }
    state.flashModelAudioParts = [];

    // Clear streaming buffer
    state.streamingBuffer = Buffer.alloc(0);

    // Clear all per-user recovery timers
    for (const [userId, timer] of state.recoveryTimers) {
      clearTimeout(timer);
    }
    state.recoveryTimers.clear();
    state.recoveryAttempts.clear();

    // Destroy all active streams, decoders, VAD instances, and clear flushing intervals
    for (const [userId, streamInfo] of state.activeStreams) {
      if (streamInfo.flushInterval) {
        clearInterval(streamInfo.flushInterval);
      }
      try { streamInfo.decoder?.destroy(); } catch (e) { /* ignore */ }
      try { streamInfo.audioStream?.destroy(); } catch (e) { /* ignore */ }
      // Destroy VAD instance
      if (streamInfo.userVAD) {
        streamInfo.userVAD.destroy().catch(() => {});
        streamInfo.userVAD = null;
      }
    }
    state.activeStreams.clear();

    // Clear translated audio state
    state.translatedAudioBuffer = Buffer.alloc(0);
    state.translatedChunks = [];
    state.translatedChunksSize = 0;

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

    // Clean up logger cache for this guild to prevent unbounded growth
    loggerCache.delete(guildId);

    // Update database
    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      {
        isActive: false,
        lastStoppedAt: new Date(),
      }
    );

    log.success('✅ Voice call translation stopped successfully');
    const elapsedMinutes = state.startTime ? Math.max(1, Math.ceil((Date.now() - state.startTime) / 60000)) : 0;
    return { success: true, message: 'Voice translation stopped', elapsedMinutes };
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
 * Check if the active connection is actually healthy (not stale/dead).
 * Used by /call command to detect stale-state scenarios.
 */
function isConnectionHealthy(guildId) {
  const state = activeConnections.get(guildId);
  if (!state) return false;
  const status = state.connection?.state?.status;
  return status === VoiceConnectionStatus.Ready || status === VoiceConnectionStatus.Connecting;
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
  isConnectionHealthy,
  getTranslationStatus,
  onActivityChange,
  getActiveCount,
  cleanupAll,
  getLanguageName,
  GEMINI_VOICES,
  GEMINI_LIVE_MODELS,
  DEFAULT_VOICE,
  DEFAULT_MODEL,
  FLASH_MODEL_ID,
  NATIVE_AUDIO_MODEL_ID,
};
