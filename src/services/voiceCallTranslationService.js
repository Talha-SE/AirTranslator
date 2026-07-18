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

/** Minimum playback buffer in seconds (300ms — play as soon as translation arrives) */
const MIN_PLAYBACK_BUFFER_SECONDS = 0.3;

/** Playback chunk duration in seconds — play in bounded slices instead of one huge buffer */
const PLAYBACK_CHUNK_SECONDS = 1.0;

/** Silence tail appended to end of translated audio to prevent Opus interpolation artifacts (ms) */
const SILENCE_TAIL_MS = 100;

/** Maximum items in Gemini send queue before dropping oldest continuous chunks */
const MAX_SEND_QUEUE_ITEMS = 30;

/** How often to sweep voice channel for missing subscriptions (ms) */
const SUBSCRIPTION_SWEEP_INTERVAL_MS = 8000;

/** Delay before re-subscribing after a stream ends or decoder error (ms) */
const STREAM_RECOVERY_DELAY_MS = 500;

/** Max recovery attempts per user before giving up */
const MAX_STREAM_RECOVERY_ATTEMPTS = 5;

/** Max number of flashModelAudioParts before dropping oldest (prevents unbounded growth for turn-based models) */
const MAX_FLASH_MODEL_PARTS = 10000; // Support ~16 min of continuous audio at ~100ms parts

/** How often to force-flush accumulated PCM for turn-based models (prevents buffer bloat on long speech) */
const TURN_BASED_FLUSH_INTERVAL_MS = 30000; // 30s

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
      isTurnBased: [FLASH_MODEL_ID, NATIVE_AUDIO_MODEL_ID].includes(modelId || DEFAULT_MODEL),
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
      /** Per-user audio send queues (continuous mode only — buffers non-active speakers) */
      userSendQueues: new Map(),
      /** Per-user queue processing locks (continuous mode) */
      userQueueProcessing: new Map(),
      /** Currently active speaker userId for continuous mode gating */
      activeSpeakerId: null,
      /** Map of userId → timestamp when they started speaking */
      speakerTimestamps: new Map(),
      /** Crosstalk flush timer — force-flushes queued speakers if active speaker talks too long */
      crosstalkFlushTimer: null,
      /** Interval ID for subscription sweep */
      subscriptionSweepInterval: null,
      /** Timeout ID for playback drain timer */
      playbackDrainTimer: null,
      /** Map of userId → recovery timer timeout ID */
      recoveryTimers: new Map(),
      /** Map of userId → recovery attempt count */
      recoveryAttempts: new Map(),
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
      // Only send keep-alive if audio player is idle (no translation playing)
      if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
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
          const streamInfo = state.activeStreams.get(oldState.id);
          if (streamInfo) {
            try { streamInfo.audioStream?.destroy(); } catch (e) { /* ignore */ }
            try { streamInfo.decoder?.destroy(); } catch (e) { /* ignore */ }
            state.activeStreams.delete(oldState.id);
          }
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
 * Set up a full audio pipeline for a single user: subscribe → decode Opus → accumulate PCM → send to Gemini on silence.
 * Called proactively for all users in channel on join, and when new users join.
 * Also triggered by speaking.start as a fallback.
 *
 * BEHAVIOR BY MODEL:
 * - Turn-based (3.1 Flash, 2.5 Native): batch mode — accumulate FULL utterance, send on silence
 * - Continuous (3.5 Live): streaming mode — flush PCM every 200ms for real-time translation
 *
 * @param {Object} state - The guild's voice call translation state
 * @param {string} userId - Discord user ID to subscribe to
 * @param {string} source - Where this subscription came from (direct, sweep, recovery-N, voiceStateUpdate)
 */
function setupUserStream(state, userId, source = 'direct') {
  const log = getLogger(state.guildId);
  const receiver = state.connection?.receiver;
  if (!receiver) return;

  if (state.activeStreams.has(userId)) return;
  if (!state.isRunning) return;

  const user = state.client.users.cache.get(userId);
  const username = user?.username || userId;

  // Reset recovery attempts on successful subscribe
  state.recoveryAttempts.set(userId, 0);

  const silenceDuration = state.isTurnBased ? FLASH_SILENCE_DURATION_MS : SILENCE_DURATION_MS;
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
  };
  state.activeStreams.set(userId, streamInfo);

  const pcmStream = audioStream.pipe(decoder);
  const pcmChunks = streamInfo.pcmChunks;
  let totalBytes = 0;

  pcmStream.on('data', (chunk) => {
    pcmChunks.push(chunk);
    totalBytes += chunk.length;
    state.lastActivityTime = Date.now();
  });

  if (!state.isTurnBased) {
    const FLUSH_INTERVAL_MS = 200;
    streamInfo.flushInterval = setInterval(() => {
      if (pcmChunks.length > streamInfo.lastFlushIndex && state.geminiSession && state.isRunning) {
        const newChunks = pcmChunks.slice(streamInfo.lastFlushIndex);
        streamInfo.lastFlushIndex = pcmChunks.length;
        const buffer = Buffer.concat(newChunks);
        // Prune old chunks from array to prevent unbounded growth
        if (streamInfo.lastFlushIndex > 20) {
          pcmChunks.splice(0, streamInfo.lastFlushIndex);
          streamInfo.lastFlushIndex = 0;
        }
        const downsampled = downsamplePcm(buffer, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
        if (downsampled.length > 0) {
          // Push to per-user queue instead of shared queue — prevents interleaving
          const userQueue = state.userSendQueues.get(userId) || [];
          userQueue.push(downsampled);
          state.userSendQueues.set(userId, userQueue);
          processUserQueue(state, userId).catch((err) => {
            log.warn(`⚠️ processUserQueue error for ${username}: ${err.message}`);
          });
        }
      }
    }, FLUSH_INTERVAL_MS);
  } else {
    // Turn-based mode: periodic force-flush prevents PCM buffer bloat on long continuous speech
    streamInfo.flushInterval = setInterval(() => {
      if (pcmChunks.length > streamInfo.lastFlushIndex && state.geminiSession && state.isRunning) {
        const newChunks = pcmChunks.slice(streamInfo.lastFlushIndex);
        streamInfo.lastFlushIndex = pcmChunks.length;
        const buffer = Buffer.concat(newChunks);
        const durationMs = Math.round((buffer.length / 2) / PCM_SAMPLE_RATE * 1000);
        log.debug(`⏰ ${username}: Force-flushing ${(buffer.length / 1024).toFixed(1)} KB (${durationMs}ms)`);
        // Prune old chunks to prevent unbounded growth
        if (streamInfo.lastFlushIndex > 20) {
          pcmChunks.splice(0, streamInfo.lastFlushIndex);
          streamInfo.lastFlushIndex = 0;
        }
        const downsampled = downsamplePcm(buffer, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
        if (downsampled.length > 0) {
          sendChunkToGemini(state, downsampled).catch((err) => {
            log.warn(`⚠️ ${username}: Force-flush send error: ${err.message}`);
          });
        }
      }
    }, TURN_BASED_FLUSH_INTERVAL_MS);
  }

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
      scheduleUserStreamRecovery(state, userId, 'empty-audio');
      return;
    }

    if (!state.geminiSession || !state.isRunning) {
      const durationMs = Math.round((totalBytes / 2) / PCM_SAMPLE_RATE * 1000);
      log.debug(`⏹️ ${username}: Speech ended — skipped (${(totalBytes / 1024).toFixed(1)} KB, ${durationMs}ms) — no active session`);
      return;
    }

    const startIndex = info?.lastFlushIndex || 0;
    if (startIndex >= pcmChunks.length) {
      log.debug(`⏹️ ${username}: No new audio since last stream flush — skipping final send`);
      return;
    }

    const finalChunks = pcmChunks.slice(startIndex);
    const fullUtterance = Buffer.concat(finalChunks);
    const durationMs = Math.round((fullUtterance.length / 2) / PCM_SAMPLE_RATE * 1000);

    if (durationMs < 200) {
      log.debug(`⏹️ ${username}: Speech too short (${durationMs}ms), skipping`);
      return;
    }

    streamInfo.utteranceCount++;
    log.info(`⏹️ ${username}: Utterance #${streamInfo.utteranceCount} ended — ${(fullUtterance.length / 1024).toFixed(1)} KB PCM, ${durationMs}ms (source: ${streamInfo.subscribeSource})`);

    const downsampled = downsamplePcm(fullUtterance, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
    if (downsampled.length === 0) {
      log.warn(`⚠️ ${username}: Downsampled audio empty, skipping`);
      return;
    }

    try {
      if (!state.isTurnBased) {
        // Continuous mode: push final utterance to per-user queue, then flush if active
        const userQueue = state.userSendQueues.get(userId) || [];
        userQueue.push(downsampled);
        state.userSendQueues.set(userId, userQueue);
        if (state.activeSpeakerId === userId) {
          await processUserQueue(state, userId);
        }
        log.success(`📤 Queued utterance for ${username} (${(downsampled.length / 1024).toFixed(1)} KB, ${durationMs}ms)`);

        // Signal turn complete to stop Gemini from generating endlessly
        if (state.geminiSession) {
          try {
            state.geminiSession.sendClientContent({ turnComplete: true });
            log.debug(`🔚 Sent turnComplete signal for ${username}`);
          } catch (e) {
            log.warn(`⚠️ Failed to send turnComplete: ${e.message}`);
          }
        }

        // Transition to next speaker — this user's stream ended
        await transitionFromSpeaker(state, userId);
      } else {
        // Turn-based mode: use shared queue as before
        await sendChunkToGemini(state, downsampled);
        log.success(`📤 Sent utterance to Gemini (${(downsampled.length / 1024).toFixed(1)} KB, ${durationMs}ms)`);
      }
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

  log.info(`🎧 Subscribed to ${username} (${userId}) [${streamInfo.subscribeSource}]`);
}

/**
 * Set up the real-time audio pipeline.
 *
 * KEY DESIGN:
 * - Turn-based models (3.1 Flash, 2.5 Native): batch mode — accumulate FULL utterance, send on silence.
 *   Gemini receives a complete sentence → produces a coherent translation.
 *   Speech ends after 2s of silence (EndBehaviorType.AfterSilence).
 *
 * - Continuous model (3.5 Live): streaming mode — flush small PCM chunks to Gemini every 200ms.
 *   Gemini translates in real-time as audio arrives.
 *   Each user's stream also sends a final chunk on silence.
 */
function setupRealtimeAudioPipeline(state) {
  const log = getLogger(state.guildId);
  const receiver = state.connection.receiver;

  log.info(`🔍 Listening for speakers in voice channel (${state.isTurnBased ? 'batch' : 'streaming'} mode)...`);

  /**
   * BATCH MODE: Accumulate the ENTIRE utterance, then send to Gemini at once.
   * Gemini receives a complete sentence → produces a coherent translation.
   * Speech ends after 2s of silence (EndBehaviorType.AfterSilence).
   */
  // Listen for speaking start — triggers subscription (proactive setup below covers existing users)
  receiver.speaking.on('start', (userId) => {
    if (userId === state.client.user.id) return;
    // If user already subscribed via proactive setup, this is a no-op
    setupUserStream(state, userId);

    // Continuous mode: track active speaker for per-user queue gating
    if (!state.isTurnBased && state.isRunning) {
      const prevSpeaker = state.activeSpeakerId;
      state.activeSpeakerId = userId;
      state.speakerTimestamps.set(userId, Date.now());

      if (prevSpeaker && prevSpeaker !== userId) {
        const prevUser = state.client.users.cache.get(prevSpeaker);
        const curUser = state.client.users.cache.get(userId);
        log.info(`🗣️ Speaker switch: ${prevUser?.username || prevSpeaker} → ${curUser?.username || userId}`);
      }

      // Set up crosstalk timer if other users have buffered audio waiting
      setupCrosstalkTimer(state, userId);

      // Process this user's queue immediately (drains any buffered audio from previous turns)
      processUserQueue(state, userId).catch(() => {});
    }
  });

  receiver.speaking.on('end', (userId) => {
    const user = state.client.users.cache.get(userId);
    log.debug(`🔇 User stopped speaking: ${user?.username || userId}`);
    if (state.onActivityChange) {
      state.onActivityChange('silence', userId);
    }
    // Note for continuous mode: speaker transition happens in pcmStream.on('end'),
    // not here. The speaking.end event fires immediately on silence detection, but
    // the Opus stream continues for another ~1.1s (AfterSilence window). We wait
    // for the actual stream end before switching, so the final audio data is captured.
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

  log.success(`✅ Audio pipeline ready — ${state.isTurnBased ? 'batch mode (full utterance → Gemini → translation)' : 'streaming mode (200ms chunks → real-time translation)'}`);

  // Proactively subscribe to ALL users currently in the voice channel
  ensureVoiceChannelSubscriptions(state);

  // Start periodic subscription sweep — self-heals missed subscriptions
  state.subscriptionSweepInterval = setInterval(() => {
    ensureVoiceChannelSubscriptions(state);
  }, SUBSCRIPTION_SWEEP_INTERVAL_MS);
}

/**
 * Build the config for gemini-3.5-live-translate-preview.
 * Uses translationConfig (NOT systemInstruction/speechConfig — those are unsupported).
 * Official docs: https://ai.google.dev/gemini-api/docs/live-api/live-translate
 */
function buildTranslateConfig(state) {
  return {
    responseModalities: ['AUDIO'],
    translationConfig: {
      targetLanguageCode: state.targetLanguage,
      echoTargetLanguage: false,
    },
  };
}

/**
 * Build a system instruction for bidirectional translation between two languages.
 * Works for ALL models (3.5 Live, Flash Live, Native Audio).
 */
function buildTranslationSystemInstruction(sourceLanguage, targetLanguage) {
  const lang1 = getLanguageName(sourceLanguage);
  const lang2 = getLanguageName(targetLanguage);
  return [
    `You are a native speaker of both ${lang1} and ${lang2}. You are a translator. Your ONLY output is a spoken translation in the target language of whatever the speaker says. Speak in a natural, fluent, and native style. Do NOT add any commentary, explanations, or text. Do NOT repeat the original text. Do NOT add your own thoughts or questions. Do NOT output any text — only audio translation.`,
    `You MUST translate bidirectionally between ${lang1} and ${lang2}.`,
    `If the speaker is speaking in ${lang1}, output ONLY the ${lang2} translation. If the speaker is speaking in ${lang2}, output ONLY the ${lang1} translation. Dont output same language translation.`,
    `If the speaker is speaking in ${lang2}, output ONLY the ${lang1} translation. If the speaker is speaking in ${lang1}, output ONLY the ${lang2} translation. Dont output same language translation.`,
    `You must auto-detect which language is being spoken by the speaker`,
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
      thinkingLevel: 'low', // Low latency for real-time translation
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
      thinkingBudget: 1024, // Small budget for contextual reasoning (disambiguating homonyms, tone/idioms)
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

  const genAI = getGenAIClient();

  // Build the system instruction for bidirectional translation (only used by 3.1/2.5 — 3.5 uses translationConfig)
  const systemInstruction = buildTranslationSystemInstruction(
    state.sourceLanguage, state.targetLanguage
  );

  // Build config based on model type (system instruction embedded at config level)
  let config;
  if (isNativeAudio) {
    config = buildNativeAudioConfig(state, systemInstruction);
    log.info(`📖 Using Native Audio config (voice: ${state.voiceName || 'Aoede'})`);
  } else if (isFlash) {
    config = buildFlashLiveConfig(state, systemInstruction);
    log.info(`📖 Using Flash Live config (voice: ${state.voiceName || 'Zephyr'})`);
  } else {
    config = buildTranslateConfig(state);
    log.info(`📖 Using Live Translate config (target: ${state.targetLanguage}, echoTarget: true)`);
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
                  // Cap count to prevent unbounded growth (each part is a base64 audio chunk)
                  if (state.flashModelAudioParts.length > MAX_FLASH_MODEL_PARTS) {
                    state.flashModelAudioParts.splice(0, state.flashModelAudioParts.length - MAX_FLASH_MODEL_PARTS);
                  }
                  // Reset timeout — if turnComplete doesn't arrive in 180s, log warning
                  if (state.flashModelPartsTimer) clearTimeout(state.flashModelPartsTimer);
                  state.flashModelPartsTimer = setTimeout(() => {
                    if (state.flashModelAudioParts.length > 0) {
                      log.warn(`⚠️ flashModelAudioParts stale (${state.flashModelAudioParts.length} parts, ${180}s timeout)`);
                      // Don't clear — Gemini may still be generating. Only log.
                    }
                  }, 180000);
                }
                // Log any text parts for debugging
                if (part.text) {
                  log.debug(`📝 Turn-based model text: ${part.text}`);
                }
              }
            }

            // When turn is complete, concatenate all buffered audio and play
            if (message?.serverContent?.turnComplete) {
              // Clear the timeout — turnComplete arrived
              if (state.flashModelPartsTimer) {
                clearTimeout(state.flashModelPartsTimer);
                state.flashModelPartsTimer = null;
              }
              if (state.flashModelAudioParts.length > 0) {
                const combined = Buffer.concat(
                  state.flashModelAudioParts.map(d => Buffer.from(d, 'base64'))
                );
                state.flashModelAudioParts = [];

                if (combined.length > 0) {
                  state.totalAudioReceived += combined.length;
                  const translatedDurationMs = Math.round((combined.length / 2) / GEMINI_OUTPUT_RATE * 1000);
                  log.success(`🔊 Turn-based model complete — received ${(combined.length / 1024).toFixed(1)} KB translated audio (${translatedDurationMs}ms)`);

                  // Use chunk-list: split into 1-second chunks so playback works incrementally
                  const chunkSize = GEMINI_OUTPUT_RATE * 2 * PLAYBACK_CHUNK_SECONDS;
                  for (let offset = 0; offset < combined.length; offset += chunkSize) {
                    const chunk = combined.subarray(offset, Math.min(offset + chunkSize, combined.length));
                    state.translatedChunks.push(chunk);
                    state.translatedChunksSize += chunk.length;
                  }

                  // Cap chunks to prevent unbounded growth (by count AND byte size)
                  while (state.translatedChunks.length > state.maxTranslatedChunks || state.translatedChunksSize > MAX_BUFFER_SIZE) {
                    const oldest = state.translatedChunks.shift();
                    if (oldest) state.translatedChunksSize -= oldest.length;
                  }

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

                    // Use chunk-list: store chunks, only concat at playback time
                    state.translatedChunks.push(audioData);
                    state.translatedChunksSize += audioData.length;

                    // Cap chunks to prevent unbounded growth (by count AND byte size)
                    while (state.translatedChunks.length > state.maxTranslatedChunks || state.translatedChunksSize > MAX_BUFFER_SIZE) {
                      const oldest = state.translatedChunks.shift();
                      if (oldest) state.translatedChunksSize -= oldest.length;
                    }

                    // Start playing if idle
                    if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
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

  if (isNativeAudio || isFlash) {
    log.info(`📝 System instruction set: ${getLanguageName(state.sourceLanguage)} ↔ ${getLanguageName(state.targetLanguage)}`);
  } else {
    log.info(`📝 Translation config: ${getLanguageName(state.sourceLanguage)} → ${getLanguageName(state.targetLanguage)} (echo: true)`);
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
 * Uses a sequential queue for ALL models to prevent concurrent writes
 * to the single WebSocket session.
 *
 * For turn-based models (2.5, 3.1): one full utterance per queue item.
 * For continuous model (3.5 Live): small 200ms streaming chunks per queue item.
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
    throw error;
  }
}

// ==============================
// Continuous Mode: Per-User Queue Gating
// ==============================

/**
 * Process a single user's audio queue for continuous mode (3.5 Live Translate).
 * Only sends audio to Gemini if this user is the currently active speaker.
 * Otherwise, audio stays buffered in their per-user queue (prevents interleaving).
 *
 * This serializes sends per-user with a per-user processing lock.
 */
async function processUserQueue(state, userId) {
  if (state.isTurnBased) return; // Only for continuous mode

  const userQueue = state.userSendQueues.get(userId);
  if (!userQueue || userQueue.length === 0) return;

  // Per-user processing lock to prevent concurrent sends for the same user
  if (state.userQueueProcessing.get(userId)) return;
  state.userQueueProcessing.set(userId, true);

  try {
    // Only send if this user is the active speaker (otherwise buffer)
    if (state.activeSpeakerId !== userId) return;

    // Drain this user's queue sequentially to Gemini
    while (userQueue.length > 0) {
      // Queue backpressure: drop oldest if queue is too deep
      if (userQueue.length > MAX_SEND_QUEUE_ITEMS) {
        userQueue.shift();
        continue;
      }

      const pcmBuffer = userQueue.shift();
      try {
        await doSendToGemini(state, pcmBuffer);
      } catch (err) {
        // On send failure, push back to front for retry, then stop this drain cycle
        userQueue.unshift(pcmBuffer);
        throw err;
      }
    }
  } finally {
    state.userQueueProcessing.set(userId, false);
  }
}

/**
 * Transition from a finished speaker to the next queued speaker.
 * Cleans up the finished user's queue state, then finds the next speaker
 * with buffered audio (oldest first) and starts draining their queue.
 */
async function transitionFromSpeaker(state, finishedUserId) {
  const log = getLogger(state.guildId);

  // Clean up the finished user's queue state
  state.userSendQueues.delete(finishedUserId);
  state.userQueueProcessing.delete(finishedUserId);
  state.speakerTimestamps.delete(finishedUserId);

  // Cancel any crosstalk timer — will be re-set if needed
  if (state.crosstalkFlushTimer) {
    clearTimeout(state.crosstalkFlushTimer);
    state.crosstalkFlushTimer = null;
  }

  // Find next speaker with buffered audio (oldest timestamp first)
  let nextSpeakerId = null;
  let oldestTimestamp = Infinity;
  for (const [uid, queue] of state.userSendQueues) {
    if (queue && queue.length > 0) {
      const ts = state.speakerTimestamps.get(uid) || Date.now();
      if (ts < oldestTimestamp) {
        oldestTimestamp = ts;
        nextSpeakerId = uid;
      }
    }
  }

  if (nextSpeakerId) {
    state.activeSpeakerId = nextSpeakerId;
    const nextUser = state.client.users.cache.get(nextSpeakerId);
    log.info(`🗣️ Switching to next speaker: ${nextUser?.username || nextSpeakerId}`);
    // Process the next speaker's queued audio
    setupCrosstalkTimer(state, nextSpeakerId);
    await processUserQueue(state, nextSpeakerId).catch(() => {});
  } else {
    state.activeSpeakerId = null;
  }
}

/**
 * Set up a crosstalk timeout for the current speaker.
 * If other users have buffered audio waiting, start a 5s timer.
 * When the timer fires, force-switch to the next queued speaker
 * (prevents one speaker from hogging the queue indefinitely).
 */
function setupCrosstalkTimer(state, currentSpeakerId) {
  // Cancel any existing timer
  if (state.crosstalkFlushTimer) {
    clearTimeout(state.crosstalkFlushTimer);
    state.crosstalkFlushTimer = null;
  }

  // Check if other users have buffered audio
  let hasWaitingUsers = false;
  for (const [uid, queue] of state.userSendQueues) {
    if (uid !== currentSpeakerId && queue && queue.length > 0) {
      hasWaitingUsers = true;
      break;
    }
  }

  if (hasWaitingUsers) {
    state.crosstalkFlushTimer = setTimeout(async () => {
      state.crosstalkFlushTimer = null;
      if (!state.isRunning) return;
      if (state.activeSpeakerId !== currentSpeakerId) return; // Already switched

      const log = getLogger(state.guildId);
      log.info(`⏰ Crosstalk timeout (5s) — force-switching to next queued speaker`);

      await transitionFromSpeaker(state, currentSpeakerId);
    }, 5000);
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
      }, 350);
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

    // Clear per-user queues and speaker gating state (continuous mode)
    state.userSendQueues.clear();
    state.userQueueProcessing.clear();
    state.speakerTimestamps.clear();
    state.activeSpeakerId = null;
    if (state.crosstalkFlushTimer) {
      clearTimeout(state.crosstalkFlushTimer);
      state.crosstalkFlushTimer = null;
    }

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

    // Clear all per-user recovery timers
    for (const [userId, timer] of state.recoveryTimers) {
      clearTimeout(timer);
    }
    state.recoveryTimers.clear();
    state.recoveryAttempts.clear();

    // Destroy all active streams, decoders, and clear flushing intervals
    for (const [userId, streamInfo] of state.activeStreams) {
      if (streamInfo.flushInterval) {
        clearInterval(streamInfo.flushInterval);
      }
      try { streamInfo.decoder?.destroy(); } catch (e) { /* ignore */ }
      try { streamInfo.audioStream?.destroy(); } catch (e) { /* ignore */ }
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
  MODEL_ID,
  FLASH_MODEL_ID,
  NATIVE_AUDIO_MODEL_ID,
};
