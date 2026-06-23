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

// Single model — gemini-3.5-live-translate-preview (dedicated real-time translation)
const MODEL_ID = 'gemini-3.5-live-translate-preview';
const GEMINI_INPUT_RATE = 16000;  // Gemini accepts 16kHz input
const GEMINI_OUTPUT_RATE = 24000; // Gemini outputs translated audio at 24kHz

const GEMINI_LIVE_MODELS = {
  [MODEL_ID]: {
    modelId: MODEL_ID,
    label: 'Live Translate',
    sampleRate: GEMINI_INPUT_RATE,
    encoding: 'LINEAR16',
    supportsBidi: true,
  },
};

/** How often to flush buffered PCM to Gemini (ms) — small chunks for real-time feel */
const STREAM_FLUSH_INTERVAL_MS = 200;

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
const DEFAULT_MODEL = MODEL_ID;
const OPUS_FRAME_DURATION_MS = 20;
const PCM_SAMPLE_RATE = 48000;
const DISCORD_FRAME_SIZE = 960; // 20ms at 48kHz

// ==============================
// Active Connections Map
// ==============================
const activeConnections = new Map();

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

/**
 * Create PCM to Opus encoder for output
 */
function createOpusEncoder() {
  return new prism.opus.Encoder({
    frameSize: DISCORD_FRAME_SIZE,
    channels: 1,
    rate: PCM_SAMPLE_RATE
  });
}

// ==============================
// Gemini Live API Integration
// ==============================

/**
 * Build the WebSocket URL for Gemini Live API with the appropriate model
 */
function buildGeminiLiveUrl(modelId, apiKey) {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}&model=${MODEL_ID}`;
}

/**
 * Create the initial setup payload for Gemini Live BidiGenerateContent
 */
function createGeminiSetupPayload(modelId, sourceLanguage, targetLanguage, voiceName) {
  const model = GEMINI_LIVE_MODELS[modelId] || GEMINI_LIVE_MODELS[DEFAULT_MODEL];
  const selectedVoice = voiceName || DEFAULT_VOICE;
  
  // Build system instruction for translation
  let systemInstruction = `You are a real-time voice translator. `;
  
  if (sourceLanguage && sourceLanguage !== 'auto') {
    const srcLang = getLanguageName(sourceLanguage);
    const tgtLang = getLanguageName(targetLanguage);
    systemInstruction += `Translate speech from ${srcLang} to ${tgtLang}. `;
  } else {
    systemInstruction += `Auto-detect the source language and translate to ${getLanguageName(targetLanguage)}. `;
  }
  
  systemInstruction += `Respond with audio in the target language. Maintain the speaker's tone and emotion. Keep translations concise and natural. Only respond with the translated speech — do not add any extra text or explanations.`;

  return {
    model: model.modelId,
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      topK: 40,
      candidateCount: 1,
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    tools: [],
    liveConnectConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: selectedVoice
          }
        }
      },
      audioConfig: {
        inputAudio: {
          encoding: model.encoding,
          sampleRateHertz: model.sampleRate,
        },
        outputAudio: {
          encoding: "LINEAR16",
          sampleRateHertz: model.sampleRate,
        }
      }
    }
  };
}

/**
 * Get language display name from code
 */
function getLanguageName(langCode) {
  const names = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
    'ko': 'Korean', 'zh': 'Chinese', 'hi': 'Hindi', 'ar': 'Arabic',
    'tr': 'Turkish', 'nl': 'Dutch', 'sv': 'Swedish', 'pl': 'Polish',
    'id': 'Indonesian', 'vi': 'Vietnamese', 'th': 'Thai', 'cs': 'Czech',
    'ro': 'Romanian', 'hu': 'Hungarian', 'da': 'Danish', 'fi': 'Finnish',
    'no': 'Norwegian', 'ms': 'Malay', 'tl': 'Filipino', 'el': 'Greek',
    'he': 'Hebrew', 'uk': 'Ukrainian', 'bn': 'Bengali', 'ta': 'Tamil',
    'te': 'Telugu', 'mr': 'Marathi', 'gu': 'Gujarati', 'pa': 'Punjabi',
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
  
  // Check if already active
  if (activeConnections.has(guildId)) {
    log.warn('Translation already active for this guild');
    return { success: false, error: 'Translation already active for this guild' };
  }

  if (!GEMINI_API_KEY) {
    log.error('Gemini API key not configured');
    return { success: false, error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' };
  }

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
    log.info(`🌐 Source: ${getLanguageName(sourceLanguage)} → Target: ${getLanguageName(targetLanguage)}, Model: ${MODEL_ID}, Voice: ${voiceName || DEFAULT_VOICE}`);

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
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    log.success('✅ Voice connection established');
    log.info(`📊 Connection state: ${connection.state.status}, Channel: ${voiceChannel.name} (${voiceChannelId})`);

    // Create connection state
    const state = {
      guildId,
      voiceChannelId,
      connection,
      sourceLanguage,
      targetLanguage,
      modelId: MODEL_ID,
      voiceName: voiceName || DEFAULT_VOICE,
      client,
      startTime: Date.now(),
      audioPlayer: createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        }
      }),
      isRunning: true,
      geminiSession: null,
      activityTimeout: null,
      lastActivityTime: Date.now(),
      translatedAudioBuffer: Buffer.alloc(0),
      onActivityChange: null,
      userSpeakingCount: 0,
      totalAudioSent: 0,
      totalAudioReceived: 0,
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

    // Handle connection state changes with detailed logging
    connection.on(VoiceConnectionStatus.Connecting, () => {
      log.info('🔄 Voice connection is connecting...');
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      log.success('🔊 Voice connection ready');
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      log.warn('⚠️ Voice connection disconnected');
      log.info('🛑 Attempting to clean up translation...');
      await stopTranslation(guildId, client);
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

  log.info('🔍 Listening for speakers in voice channel (real-time streaming mode)...');

  /**
   * When a user starts speaking, open a persistent audio receiver
   * and periodically flush accumulated PCM to Gemini.
   */
  receiver.speaking.on('start', (userId) => {
    // Skip the bot's own audio — prevent echo loop
    if (userId === state.client.user.id) return;

    const user = state.client.users.cache.get(userId);
    const username = user?.username || userId;
    state.userSpeakingCount++;
    state.lastActivityTime = Date.now();

    log.info(`🗣️ User started speaking: ${username} (#${state.userSpeakingCount})`);

    if (state.onActivityChange) {
      state.onActivityChange('speaking', userId);
    }

    // Create a persistent audio stream for this user
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 3000, // 3s silence to end speech (was 2s, too aggressive)
      },
    });

    // Decode Opus → PCM
    const decoder = createOpusDecoder();
    const pcmStream = audioStream.pipe(decoder);

    // Accumulate PCM chunks and flush to Gemini periodically
    const pcmChunks = [];
    let totalBytes = 0;

    const flushToGemini = async () => {
      if (pcmChunks.length === 0 || !state.geminiSession || !state.isRunning) return;

      const combined = Buffer.concat(pcmChunks);
      pcmChunks.length = 0; // Clear the array in-place

      if (combined.length === 0) return;

      // Downsample 48kHz → 16kHz for Gemini input
      const downsampled = downsamplePcm(combined, PCM_SAMPLE_RATE, GEMINI_INPUT_RATE);
      if (downsampled.length === 0) return;

      try {
        await sendChunkToGemini(state, downsampled);
        log.debug(`📤 Streamed ${(downsampled.length / 1024).toFixed(1)} KB PCM to Gemini (${username})`);
      } catch (err) {
        log.error(`❌ Failed to stream audio chunk: ${err.message}`);
      }
    };

    // Flush every 200ms for real-time feel
    const flushTimer = setInterval(flushToGemini, STREAM_FLUSH_INTERVAL_MS);

    // Store stream info for cleanup
    state.activeStreams.set(userId, { pcmChunks, flushTimer, totalBytes: 0, decoder });

    pcmStream.on('data', (chunk) => {
      pcmChunks.push(chunk);
      totalBytes += chunk.length;
      state.lastActivityTime = Date.now();
    });

    pcmStream.on('end', async () => {
      // Flush any remaining audio
      await flushToGemini();

      // Clean up
      const streamInfo = state.activeStreams.get(userId);
      if (streamInfo) {
        clearInterval(streamInfo.flushTimer);
        state.activeStreams.delete(userId);
      }

      const durationMs = Math.round((totalBytes / 2) / PCM_SAMPLE_RATE * 1000);
      log.info(`⏹️ ${username}: Speech ended (${(totalBytes / 1024).toFixed(1)} KB PCM, ${durationMs}ms)`);
    });

    audioStream.on('error', (err) => {
      log.error(`❌ Audio stream error for ${username}: ${err.message}`);
      const streamInfo = state.activeStreams.get(userId);
      if (streamInfo) {
        clearInterval(streamInfo.flushTimer);
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

  log.success('✅ Real-time audio pipeline ready — streaming PCM chunks to Gemini Live');
}

/**
 * Build the config for gemini-3.5-live-translate-preview.
 * This model uses dedicated translationConfig — no system instructions needed.
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
 * Connect a persistent Gemini Live WebSocket session for the guild.
 * This session stays open and streams audio bidirectionally.
 */
async function connectGeminiSession(state) {
  const log = getLogger(state.guildId);
  const model = GEMINI_LIVE_MODELS[state.modelId] || GEMINI_LIVE_MODELS[DEFAULT_MODEL];

  log.info(`🔌 Opening Gemini Live WebSocket session for model: ${MODEL_ID}...`);

  const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Always use translationConfig — this is the dedicated translate model
  const config = buildTranslateConfig(state);
  log.info(`📖 Using translationConfig (target: ${state.targetLanguage || 'en'})`);

  const session = await genAI.live.connect({
    model: model.modelId,
    config,
    callbacks: {
      onopen: () => {
        log.success('✅ Gemini Live WebSocket session connected');
      },
      onmessage: (message) => {
        try {
          // Response audio arrives as serverContent.modelTurn.parts[].inlineData
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

                  // Queue the audio for playback
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
        } catch (err) {
          log.error(`❌ Error processing Gemini Live response: ${err.message}`);
        }
      },
      onerror: (error) => {
        log.error(`❌ Gemini Live WebSocket error: ${error?.message || JSON.stringify(error)}`);
      },
      onclose: (event) => {
        log.warn(`🔌 Gemini Live WebSocket closed (code: ${event?.code || 'unknown'})`);
        state.geminiSession = null;
      },
    },
  });

  state.geminiSession = session;
  log.success('✅ Gemini Live session established and ready for real-time audio streaming');
  return session;
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
  
  // Wait until we have at least 1 second of audio (24kHz * 2 bytes * 1s = 48000 bytes)
  const minBufferSize = GEMINI_OUTPUT_RATE * 2 * 1;
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

    // Clear all active stream flush timers
    for (const [userId, streamInfo] of state.activeStreams) {
      clearInterval(streamInfo.flushTimer);
    }
    state.activeStreams.clear();

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
};
