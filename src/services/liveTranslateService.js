/**
 * Gemini 3.5 Live Translate Service — DIRECT API STREAM
 *
 * A separate, self-contained implementation for the
 * `gemini-3.5-live-translate-preview` model. This model behaves differently
 * from the turn-based models (Flash Live / Native Audio) handled by
 * voiceCallTranslationService.js:
 *
 *   • Continuous stream processing — translates AS the speaker talks,
 *     no waiting for silence or turn boundaries (per Google docs).
 *   • Audio input ONLY — no system instructions, no text seeding,
 *     no tools. A direct link to the API, nothing in between.
 *   • No VAD / no noise filtering / no gain boost — the model itself is
 *     designed to filter background noise and detect the spoken language.
 *   • translationConfig.targetLanguageCode — the user picks the OUTPUT
 *     language in the dashboard; the source language is auto-detected.
 *   • Voice replication — the model speaks in the original speaker's own
 *     voice, so there is no voice selection for this model.
 *
 * Audio format (per Google docs):
 *   Input : raw 16-bit little-endian PCM @ 16kHz mono, sent in ~100ms chunks
 *   Output: raw 16-bit little-endian PCM @ 24kHz mono
 *
 * This file does NOT modify or depend on voiceCallTranslationService.js —
 * the other models keep their existing pipeline untouched.
 */

const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { GoogleGenAI } = require('@google/genai');
const { Readable } = require('stream');
const VoiceCallTranslation = require('../models/VoiceCallTranslation');

// Optional native Opus decoder (falls back to prism-media pure JS)
let OpusDecoderClass = null;
try {
  const opusPkg = require('@discordjs/opus');
  OpusDecoderClass = opusPkg?.OpusDecoder || opusPkg?.default?.OpusDecoder || null;
} catch (e) {
  OpusDecoderClass = null;
}

// ==============================
// Configuration
// ==============================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

/** The model id used by the dashboard / DB config for this direct service */
const LIVE_TRANSLATE_MODEL_ID = 'gemini-3.5-live-translate-preview';

const GEMINI_INPUT_RATE = 16000;   // 16kHz PCM in (per Google docs)
const GEMINI_OUTPUT_RATE = 24000;  // 24kHz PCM out (per Google docs)
const PCM_SAMPLE_RATE = 48000;     // Discord audio
const DISCORD_FRAME_SIZE = 960;    // 20ms at 48kHz

/** Google docs: send audio in chunks of 100ms */
const SEND_CHUNK_MS = 100;
const SEND_CHUNK_BYTES_16K = GEMINI_INPUT_RATE * 2 * (SEND_CHUNK_MS / 1000);   // 3200 B
/** Accumulate 100ms of 48kHz PCM before downsampling (better resampler quality) */
const ACCUMULATE_BYTES_48K = PCM_SAMPLE_RATE * 2 * (SEND_CHUNK_MS / 1000);     // 9600 B

/** Minimum translated audio before playback starts (0.3s at 24kHz 16-bit mono) */
const MIN_STREAMING_BUFFER_BYTES = GEMINI_OUTPUT_RATE * 2 * 0.3;
/** Playback slice duration — bounded so long sessions stay responsive */
const PLAYBACK_CHUNK_SECONDS = 1.0;
/** Silence tail to prevent Opus interpolation artifacts at end of speech */
const SILENCE_TAIL_MS = 100;

/** Buffer caps — protect memory if playback ever lags behind */
const MAX_BUFFER_SIZE = GEMINI_OUTPUT_RATE * 2 * 1200; // ~57.6MB (~20 min)
const MAX_TRANSLATED_CHUNKS = 2000;

/** Gemini reconnection */
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;

/** Session timeout: 6 hours (same cap as the other models) */
const SESSION_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** Keep-alive silence interval */
const KEEP_ALIVE_INTERVAL_MS = 45000;

/**
 * Map dashboard language codes to the BCP-47 codes supported by
 * gemini-3.5-live-translate-preview (see Google docs supported languages).
 */
const BCP47_OVERRIDES = {
  'tl': 'fil',      // Filipino
  'zh': 'zh-Hans',  // Chinese (Simplified)
  'zh-tw': 'zh-Hant', // Chinese (Traditional)
  'pt': 'pt-PT',    // Portuguese (Portugal)
};

function toBcp47(langCode) {
  if (!langCode) return 'en';
  return BCP47_OVERRIDES[langCode] || langCode;
}

// ==============================
// Cached GoogleGenAI client
// ==============================
let cachedGenAIClient = null;
function getGenAIClient() {
  if (!cachedGenAIClient) {
    cachedGenAIClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return cachedGenAIClient;
}

// ==============================
// Active sessions (independent of the other models' map)
// ==============================
const activeSessions = new Map();
const startLocks = new Map();
const loggerCache = new Map();

function getLogger(guildId) {
  const cacheKey = guildId || '__global__';
  if (loggerCache.has(cacheKey)) return loggerCache.get(cacheKey);
  const scope = guildId ? `live-translate:${guildId}` : 'live-translate';
  const C = { reset: '\x1b[0m', dim: '\x1b[2m', gray: '\x1b[90m', blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };
  const logger = {
    debug: (m) => console.log(`${C.dim}${new Date().toISOString()}${C.reset} ${C.gray}🐛 DEBUG${C.reset} ${C.dim}[${scope}]${C.reset} ${m}`),
    info: (m) => console.log(`${C.dim}${new Date().toISOString()}${C.reset} ${C.blue}ℹ️ INFO${C.reset} ${C.dim}[${scope}]${C.reset} ${m}`),
    success: (m) => console.log(`${C.dim}${new Date().toISOString()}${C.reset} ${C.green}✅ SUCCESS${C.reset} ${C.dim}[${scope}]${C.reset} ${m}`),
    warn: (m) => console.log(`${C.dim}${new Date().toISOString()}${C.reset} ${C.yellow}⚠️ WARN${C.reset} ${C.dim}[${scope}]${C.reset} ${m}`),
    error: (m) => console.log(`${C.dim}${new Date().toISOString()}${C.reset} ${C.red}❌ ERROR${C.reset} ${C.dim}[${scope}]${C.reset} ${m}`),
  };
  loggerCache.set(cacheKey, logger);
  return logger;
}

// ==============================
// Audio helpers (resampling via libsamplerate, with fallbacks)
// ==============================
class SyncResampler {
  constructor(opts) {
    const { SampleRate } = require('libsamplerate');
    this.stream = new SampleRate(opts);
    this.output = [];
    this.stream.on('data', (chunk) => this.output.push(chunk));
  }
  process(buffer) {
    this.output = [];
    this.stream.write(buffer);
    this.stream.end();
    return Buffer.concat(this.output);
  }
}

function getResampler(fromRate, toRate) {
  return new SyncResampler({
    type: 1, // SRC_SINC_MEDIUM_QUALITY
    channels: 1,
    fromRate,
    fromDepth: 16,
    toRate,
    toDepth: 16,
  });
}

function downsamplePcm(inputBuffer, inputRate, outputRate) {
  if (inputRate === outputRate) return inputBuffer;
  if (inputBuffer.length === 0) return inputBuffer;
  try {
    return getResampler(inputRate, outputRate).process(inputBuffer);
  } catch (err) {
    const ratio = inputRate / outputRate;
    const outputLength = Math.floor((inputBuffer.length / 2) / ratio);
    const output = Buffer.alloc(outputLength * 2);
    for (let i = 0; i < outputLength; i++) {
      const src = Math.floor(i * ratio);
      if (src * 2 + 1 < inputBuffer.length) output.writeInt16LE(inputBuffer.readInt16LE(src * 2), i * 2);
    }
    return output;
  }
}

function upsamplePcm(inputBuffer, inputRate, outputRate) {
  if (inputRate === outputRate) return inputBuffer;
  if (inputBuffer.length === 0) return inputBuffer;
  try {
    return getResampler(inputRate, outputRate).process(inputBuffer);
  } catch (err) {
    const ratio = outputRate / inputRate;
    const outputLength = Math.floor(inputBuffer.length * ratio / 2) * 2;
    const output = Buffer.alloc(outputLength);
    for (let i = 0; i < outputLength / 2; i++) {
      const src = Math.floor(i / ratio);
      if (src * 2 + 1 < inputBuffer.length) output.writeInt16LE(inputBuffer.readInt16LE(src * 2), i * 2);
    }
    return output;
  }
}

function createOpusDecoder() {
  if (OpusDecoderClass) {
    try {
      const native = new OpusDecoderClass({ rate: PCM_SAMPLE_RATE, channels: 1 });
      if (native && typeof native.pipe === 'function') return native;
    } catch (e) { /* fall through to prism-media */ }
  }
  return new prism.opus.Decoder({ frameSize: DISCORD_FRAME_SIZE, channels: 1, rate: PCM_SAMPLE_RATE });
}

function appendSilenceTail(stereoBuffer) {
  const silenceSamples = Math.floor(PCM_SAMPLE_RATE * 2 * (SILENCE_TAIL_MS / 1000));
  return Buffer.concat([stereoBuffer, Buffer.alloc(silenceSamples * 2)]);
}

// ==============================
// Gemini Live Translate session (direct connection)
// ==============================

/**
 * Connect to gemini-3.5-live-translate-preview.
 * Config mirrors Google's documented setup exactly:
 *   - AUDIO output modality only
 *   - translationConfig.targetLanguageCode = the user's chosen output language
 *   - NO systemInstruction, NO voice config, NO transcription extras
 */
async function connectTranslateSession(state) {
  const log = getLogger(state.guildId);
  log.info(`🔌 Opening DIRECT Gemini Live Translate session (${LIVE_TRANSLATE_MODEL_ID})...`);

  const genAI = getGenAIClient();

  const config = {
    responseModalities: ['AUDIO'],
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    translationConfig: {
      targetLanguageCode: toBcp47(state.targetLanguage),
    },
    contextWindowCompression: {
      triggerTokens: '0',
      slidingWindow: { targetTokens: '0' },
    },
  };

  const session = await genAI.live.connect({
    model: LIVE_TRANSLATE_MODEL_ID,
    config,
    callbacks: {
      onopen: () => {
        log.success('✅ Gemini Live Translate session connected (continuous stream)');
      },
      onmessage: (message) => {
        try {
          // Translated audio arrives as modelTurn inline PCM @ 24kHz — feed it
          // straight into the playback buffer. Nothing else is added.
          const modelTurn = message?.serverContent?.modelTurn;
          if (modelTurn?.parts) {
            for (const part of modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData?.data) {
                const pcmData = Buffer.from(part.inlineData.data, 'base64');
                state.streamingBuffer = Buffer.concat([state.streamingBuffer, pcmData]);

                // Play as soon as a playback slice is available (sub-second latency)
                while (state.streamingBuffer.length >= MIN_STREAMING_BUFFER_BYTES) {
                  const chunk = state.streamingBuffer.subarray(0, MIN_STREAMING_BUFFER_BYTES);
                  state.streamingBuffer = state.streamingBuffer.subarray(MIN_STREAMING_BUFFER_BYTES);
                  state.translatedChunks.push(chunk);
                  state.translatedChunksSize += chunk.length;
                  while (state.translatedChunks.length > MAX_TRANSLATED_CHUNKS || state.translatedChunksSize > MAX_BUFFER_SIZE) {
                    const oldest = state.translatedChunks.shift();
                    if (oldest) state.translatedChunksSize -= oldest.length;
                  }
                  if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
                    playNextChunk(state);
                  }
                }
              }
            }
          }

          // turnComplete only marks end of a translated segment — flush any
          // sub-threshold remainder so nothing gets stuck in the buffer.
          if (message?.serverContent?.turnComplete && state.streamingBuffer.length > 0) {
            state.totalAudioReceived += state.streamingBuffer.length;
            state.translatedChunks.push(state.streamingBuffer);
            state.translatedChunksSize += state.streamingBuffer.length;
            state.streamingBuffer = Buffer.alloc(0);
            if (state.audioPlayer.state.status === AudioPlayerStatus.Idle) {
              playNextChunk(state);
            }
          }
        } catch (err) {
          log.error(`❌ Error processing Live Translate message: ${err.message}`);
        }
      },
      onerror: (error) => {
        log.error(`❌ Live Translate WS error: ${error?.message || JSON.stringify(error)}`);
        state.session = null;
        if (state.isRunning && !state.isReconnecting) {
          state.isReconnecting = true;
          reconnectTranslateSession(state).catch(() => {});
        }
      },
      onclose: (event) => {
        log.warn(`🔌 Live Translate WS closed (code: ${event?.code || 'unknown'})`);
        state.session = null;
        if (state.isRunning && !state.isReconnecting) {
          state.isReconnecting = true;
          reconnectTranslateSession(state).catch(() => {});
        }
      },
    },
  });

  state.session = session;
  state.isReconnecting = false;
  log.success(`✅ Live Translate session established → output: ${state.targetLanguage} (source auto-detected by model)`);
  return session;
}

async function reconnectTranslateSession(state) {
  const log = getLogger(state.guildId);
  for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    log.info(`🔄 Live Translate reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, Math.max(1, delay)));
    if (!state.isRunning || state.session) {
      state.isReconnecting = false;
      return;
    }
    try {
      await connectTranslateSession(state);
      log.success(`✅ Live Translate reconnected on attempt ${attempt}`);
      state.isReconnecting = false;
      return;
    } catch (err) {
      log.error(`❌ Live Translate reconnect attempt ${attempt} failed: ${err.message}`);
    }
  }
  log.error(`❌ Live Translate reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
  state.isReconnecting = false;
}

/**
 * Send one 16kHz PCM block straight to the session.
 * NO gain, NO VAD gate, NO silence tail — direct to the API.
 */
function sendAudioToSession(state, pcm16Buffer) {
  if (!state.session || pcm16Buffer.length === 0) return;
  try {
    state.session.sendRealtimeInput({
      audio: {
        data: pcm16Buffer.toString('base64'),
        mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
      },
    });
    state.totalAudioSent += pcm16Buffer.length;
  } catch (error) {
    getLogger(state.guildId).error(`❌ Live Translate send error: ${error.message}`);
    state.session = null;
    if (state.isRunning && !state.isReconnecting) {
      state.isReconnecting = true;
      reconnectTranslateSession(state).catch(() => {});
    }
  }
}

// ==============================
// Per-user continuous input streams
// ==============================

/**
 * Subscribe to one user and stream their mic CONTINUOUSLY to Gemini.
 * EndBehaviorType.Manual keeps the stream open — the model handles
 * speech/noise segmentation itself (no VAD, no silence flush).
 */
async function setupUserStream(state, userId) {
  const log = getLogger(state.guildId);
  const receiver = state.connection?.receiver;
  if (!receiver || !state.isRunning) return;
  if (state.activeStreams.has(userId)) return;

  // Never listen to bots (including ourselves) — prevents feedback loops
  try {
    if (state.client.user?.id === userId) return;
    const member = state.client.guilds.cache.get(state.guildId)?.channels?.cache
      .get(state.voiceChannelId)?.members?.get(userId);
    if (member?.user?.bot) return;
    if (!member) {
      const user = await state.client.users.fetch(userId).catch(() => null);
      if (!user || user.bot) return;
    }
  } catch (e) { /* proceed — treat as human */ }

  const username = state.client.users.cache.get(userId)?.username || userId;
  const audioStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.Manual },
  });
  const decoder = createOpusDecoder();
  const pcmStream = audioStream.pipe(decoder);

  const info = { audioStream, decoder, username, accumulator: Buffer.alloc(0) };
  state.activeStreams.set(userId, info);
  log.info(`🎧 [Live Translate] streaming ${username}'s mic continuously (no VAD — model handles it)`);

  let accumulator = Buffer.alloc(0);
  pcmStream.on('data', (chunk) => {
    if (!state.isRunning) return;
    state.lastActivityTime = Date.now();
    accumulator = Buffer.concat([accumulator, chunk]);
    // Emit fixed 100ms blocks (per Google docs) — downsample then send direct
    while (accumulator.length >= ACCUMULATE_BYTES_48K) {
      const block = accumulator.subarray(0, ACCUMULATE_BYTES_48K);
      accumulator = accumulator.subarray(ACCUMULATE_BYTES_48K);
      const pcm16 = downsamplePcm(block, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
      if (pcm16.length > 0) sendAudioToSession(state, pcm16);
    }
  });

  const handleError = (err) => {
    if (err?.message?.includes('DAVE') || err?.message?.includes('decrypt')) return;
    log.warn(`⚠️ [Live Translate] stream error for ${username}: ${err.message}`);
    teardownUserStream(state, userId);
  };
  audioStream.on('error', handleError);
  decoder.on('error', handleError);
  pcmStream.on('error', handleError);
  pcmStream.on('end', () => teardownUserStream(state, userId));
}

function teardownUserStream(state, userId) {
  const info = state.activeStreams.get(userId);
  if (!info) return;
  try { info.decoder?.destroy?.(); } catch (e) { /* ignore */ }
  try { info.audioStream?.destroy?.(); } catch (e) { /* ignore */ }
  state.activeStreams.delete(userId);
}

/** Subscribe to everyone currently in the channel; drop users who left. */
function ensureChannelSubscriptions(state) {
  if (!state.isRunning) return;
  try {
    const channel = state.client.guilds.cache.get(state.guildId)?.channels?.cache.get(state.voiceChannelId);
    if (!channel || channel.type !== 2) return;
    for (const [userId, member] of channel.members) {
      if (!member.user.bot && !state.activeStreams.has(userId)) {
        setupUserStream(state, userId);
      }
    }
    for (const userId of state.activeStreams.keys()) {
      if (!channel.members.has(userId)) teardownUserStream(state, userId);
    }
  } catch (e) { /* ignore sweep errors */ }
}

// ==============================
// Output playback (24kHz PCM → Discord)
// ==============================

function playNextChunk(state) {
  if (state.translatedChunks.length === 0) return;
  if (state.audioPlayer.state.status !== AudioPlayerStatus.Idle) return;
  const log = getLogger(state.guildId);
  try {
    const maxChunkBytes = GEMINI_OUTPUT_RATE * 2 * PLAYBACK_CHUNK_SECONDS;
    let bytes = 0;
    let take = 0;
    for (let i = 0; i < state.translatedChunks.length; i++) {
      bytes += state.translatedChunks[i].length;
      take = i + 1;
      if (bytes >= maxChunkBytes) break;
    }
    const spliced = state.translatedChunks.splice(0, take);
    for (const c of spliced) state.translatedChunksSize -= c.length;
    const pcmData = Buffer.concat(spliced);

    const upsampled = upsamplePcm(pcmData, GEMINI_OUTPUT_RATE, PCM_SAMPLE_RATE);
    const stereo = Buffer.alloc(upsampled.length * 2);
    for (let i = 0; i < upsampled.length; i += 2) {
      const s = upsampled.readInt16LE(i);
      stereo.writeInt16LE(s, i * 2);
      stereo.writeInt16LE(s, i * 2 + 2);
    }
    const finalBuffer = state.translatedChunks.length === 0 && state.streamingBuffer.length === 0
      ? appendSilenceTail(stereo)
      : stereo;

    const resource = createAudioResource(Readable.from([finalBuffer]), { inputType: StreamType.Raw });
    state.audioPlayer.play(resource);
    state.totalAudioReceived += pcmData.length;
    log.debug(`▶️ [Live Translate] playing ${(bytes / 1024).toFixed(1)} KB (${(state.translatedChunksSize / 1024).toFixed(1)} KB queued)`);
  } catch (error) {
    log.error(`❌ [Live Translate] playback error: ${error.message}`);
  }
}

// ==============================
// Public API — start / stop / status
// ==============================

/**
 * Start direct live translation for a guild.
 * Same signature as voiceCallTranslationService.startTranslation so the
 * existing entry points (/call, auto-join, dashboard) route here unchanged.
 */
async function startTranslation(guildId, voiceChannelId, sourceLanguage, targetLanguage, modelId, client, voiceName, remainingMinutes = null) {
  const log = getLogger(guildId);

  if (startLocks.has(guildId)) {
    return { success: false, error: 'Translation is already starting for this guild. Please wait a moment and try again.' };
  }
  if (activeSessions.has(guildId)) {
    return { success: false, error: 'Translation already active for this guild' };
  }
  if (!GEMINI_API_KEY) {
    log.error('Gemini API key not configured');
    return { success: false, error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' };
  }

  startLocks.set(guildId, true);
  let connection = null;
  let state = null;
  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return { success: false, error: 'Guild not found' };

    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel || voiceChannel.type !== 2) {
      return { success: false, error: 'Voice channel not found or invalid' };
    }

    log.info(`🎤 Starting LIVE TRANSLATE (direct stream) in "${voiceChannel.name}"...`);
    log.info(`🌐 Output language: ${targetLanguage} — source auto-detected by the model (no VAD, no instructions)`);

    // ---- Discord voice connection ----
    connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (e) {
      log.error(`❌ Voice connection failed: ${e.message}`);
      try { connection.destroy(); } catch (d) { /* ignore */ }
      return { success: false, error: `Voice connection failed: ${e.message}` };
    }
    log.success('✅ Voice connection established');

    state = {
      guildId,
      voiceChannelId,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      modelId: LIVE_TRANSLATE_MODEL_ID,
      client,
      connection,
      audioPlayer: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } }),
      session: null,
      isRunning: true,
      isReconnecting: false,
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      activeStreams: new Map(),
      translatedChunks: [],
      translatedChunksSize: 0,
      streamingBuffer: Buffer.alloc(0),
      totalAudioSent: 0,
      totalAudioReceived: 0,
      remainingMinutes,
      sessionTimeout: null,
      keepAliveInterval: null,
      freeUsageAutoStopTimer: null,
      sweepInterval: null,
      voiceStateHandler: null,
    };

    connection.subscribe(state.audioPlayer);

    // Chain next queued chunk when the player goes idle
    state.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (state.isRunning && state.translatedChunks.length > 0) playNextChunk(state);
    });
    state.audioPlayer.on('error', (err) => {
      log.error(`❌ Audio player error: ${err.message}`);
    });

    // ---- Direct Gemini session ----
    await connectTranslateSession(state);

    // ---- Continuous mic capture ----
    ensureChannelSubscriptions(state);
    state.sweepInterval = setInterval(() => ensureChannelSubscriptions(state), 8000);

    const voiceStateHandler = (oldState, newState) => {
      if (oldState.guild.id !== guildId && newState.guild.id !== guildId) return;
      if (newState.channelId === voiceChannelId && oldState.channelId !== voiceChannelId && !newState.member?.user?.bot) {
        setupUserStream(state, newState.id);
      }
      if (oldState.channelId === voiceChannelId && newState.channelId !== voiceChannelId) {
        teardownUserStream(state, oldState.id);
      }
    };
    client.on('voiceStateUpdate', voiceStateHandler);
    state.voiceStateHandler = voiceStateHandler;

    // ---- Keep-alive silence (keeps Discord connection warm) ----
    const silenceFrame = Buffer.alloc(960 * 2 * 2);
    state.keepAliveInterval = setInterval(() => {
      if (!state.isRunning || !state.connection) return;
      if (state.audioPlayer.state.status === AudioPlayerStatus.Idle && state.translatedChunks.length === 0) {
        try {
          state.audioPlayer.play(createAudioResource(Readable.from([silenceFrame]), { inputType: StreamType.Raw }));
        } catch (e) { /* ignore */ }
      }
    }, KEEP_ALIVE_INTERVAL_MS);

    // ---- 6h session cap ----
    state.sessionTimeout = setTimeout(async () => {
      log.warn('⏰ Live Translate session timeout (6h) — stopping');
      await stopTranslation(guildId, client);
    }, SESSION_MAX_DURATION_MS);

    // ---- Free daily limit auto-stop (mirrors other models) ----
    if (remainingMinutes !== null && remainingMinutes > 0) {
      state.freeUsageAutoStopTimer = setTimeout(async () => {
        log.warn(`⏰ Free usage limit reached (${remainingMinutes} min) — auto-stopping Live Translate`);
        await stopTranslation(guildId, client);
      }, remainingMinutes * 60 * 1000);
    }

    // ---- Voice connection recovery ----
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      log.warn('⚠️ Voice disconnected — trying to recover...');
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Ready, 30_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        ensureChannelSubscriptions(state);
      } catch (e) {
        if (state.isRunning) await stopTranslation(guildId, client);
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      activeSessions.delete(guildId);
    });
    connection.on('error', (err) => log.error(`❌ Voice connection error: ${err.message}`));

    activeSessions.set(guildId, state);

    // ---- DB mirror ----
    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      { isActive: true, lastStartedAt: new Date(), enabled: true },
      { upsert: true }
    );

    log.success('✅ Live Translate (direct) started successfully');
    return { success: true, message: 'Live translation started (gemini-3.5-live-translate-preview — direct stream)' };
  } catch (error) {
    log.error(`Failed to start Live Translate: ${error.message}`);
    activeSessions.delete(guildId);
    // Tear down anything partially created before the failure
    if (state) {
      state.isRunning = false;
      for (const userId of state.activeStreams.keys()) teardownUserStream(state, userId);
      try { state.session?.close(); } catch (e) { /* ignore */ }
      try { state.audioPlayer?.stop(); } catch (e) { /* ignore */ }
      if (state.sweepInterval) clearInterval(state.sweepInterval);
      if (state.keepAliveInterval) clearInterval(state.keepAliveInterval);
      if (state.sessionTimeout) clearTimeout(state.sessionTimeout);
      if (state.freeUsageAutoStopTimer) clearTimeout(state.freeUsageAutoStopTimer);
      if (state.voiceStateHandler && client) client.removeListener('voiceStateUpdate', state.voiceStateHandler);
    }
    try { connection?.destroy(); } catch (e) { /* ignore */ }
    return { success: false, error: error.message };
  } finally {
    startLocks.delete(guildId);
  }
}

/** Record daily usage for free servers (same DB fields as the other models) */
async function recordDailyUsage(guildId, elapsedMinutes) {
  try {
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      [
        {
          $set: {
            dailyUsageDate: { $cond: { if: { $ne: ['$dailyUsageDate', today] }, then: today, else: '$dailyUsageDate' } },
            dailyMinutesUsed: {
              $cond: {
                if: { $ne: ['$dailyUsageDate', today] },
                then: elapsedMinutes,
                else: { $add: ['$dailyMinutesUsed', elapsedMinutes] },
              },
            },
          },
        },
      ],
      { new: true }
    );
  } catch (e) {
    console.error('Failed to record daily VCT usage (live translate):', e);
  }
}

/**
 * Stop live translation for a guild.
 */
async function stopTranslation(guildId, client) {
  const log = getLogger(guildId);
  try {
    const state = activeSessions.get(guildId);
    if (!state) {
      log.warn('⚠️ No active Live Translate session to stop');
      return { success: false, error: 'No active translation' };
    }

    const elapsedMinutes = state.startTime ? Math.max(1, Math.ceil((Date.now() - state.startTime) / 60000)) : 0;
    log.info(`🛑 Stopping Live Translate (uptime ${elapsedMinutes} min, sent ${(state.totalAudioSent / 1024).toFixed(0)} KB, received ${(state.totalAudioReceived / 1024).toFixed(0)} KB)`);

    state.isRunning = false;
    activeSessions.delete(guildId);

    if (state.sessionTimeout) clearTimeout(state.sessionTimeout);
    if (state.keepAliveInterval) clearInterval(state.keepAliveInterval);
    if (state.freeUsageAutoStopTimer) clearTimeout(state.freeUsageAutoStopTimer);
    if (state.sweepInterval) clearInterval(state.sweepInterval);
    if (state.voiceStateHandler && (client || state.client)) {
      (client || state.client).removeListener('voiceStateUpdate', state.voiceStateHandler);
    }

    for (const userId of state.activeStreams.keys()) teardownUserStream(state, userId);

    try { state.audioPlayer?.stop(); } catch (e) { /* ignore */ }
    try { state.connection?.destroy(); } catch (e) { /* ignore */ }
    try { state.session?.close(); } catch (e) { /* ignore */ }

    state.translatedChunks = [];
    state.translatedChunksSize = 0;
    state.streamingBuffer = Buffer.alloc(0);

    if (state.remainingMinutes !== null) await recordDailyUsage(guildId, elapsedMinutes);

    await VoiceCallTranslation.findOneAndUpdate(
      { guildId },
      { isActive: false, lastStoppedAt: new Date() }
    );

    log.success('✅ Live Translate stopped');
    return { success: true, message: 'Voice translation stopped', elapsedMinutes };
  } catch (error) {
    log.error(`❌ Error stopping Live Translate: ${error.message}`);
    activeSessions.delete(guildId);
    return { success: false, error: error.message };
  }
}

function isTranslationActive(guildId) {
  return activeSessions.has(guildId);
}

function isConnectionHealthy(guildId) {
  const state = activeSessions.get(guildId);
  if (!state) return false;
  const status = state.connection?.state?.status;
  return status === VoiceConnectionStatus.Ready || status === VoiceConnectionStatus.Connecting;
}

function getTranslationStatus(guildId) {
  const state = activeSessions.get(guildId);
  if (!state) return { active: false };
  return {
    active: true,
    voiceChannelId: state.voiceChannelId,
    sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage,
    modelId: state.modelId,
    voiceName: null, // model replicates the speaker's voice
    lastActivity: state.lastActivityTime,
    uptime: Date.now() - (state.startTime || Date.now()),
  };
}

function getActiveCount() {
  return activeSessions.size;
}

async function cleanupAll() {
  for (const guildId of Array.from(activeSessions.keys())) {
    try { await stopTranslation(guildId); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  LIVE_TRANSLATE_MODEL_ID,
  startTranslation,
  stopTranslation,
  isTranslationActive,
  isConnectionHealthy,
  getTranslationStatus,
  getActiveCount,
  cleanupAll,
};
