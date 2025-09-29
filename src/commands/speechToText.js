const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { joinVoiceChannel, EndBehaviorType, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
// Google disabled by request; keep import removed
const STTSettings = require('../models/STTSettings');

// Env keys (documented in reply): MISTRAL_API_KEY, GOOGLE_API_KEY
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
// Force Mistral-only per user request
const GOOGLE_API_KEY = undefined;

// Default transcription model (can be overridden per guild via DB)
const DEFAULT_MISTRAL_MODEL = 'voxtral-mini-latest';

// Provider IDs
const PROVIDERS = ['mistral'];

// In-memory sessions per guild: { connection, outputChannelId, streamsByUser }
const sessions = new Map();

// Simple stable hash for routing
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function routeProviderForUser(userId) { return 'mistral'; }

// WAV utils
function pcmToWav(buffer, sampleRate = 48000, numChannels = 1) {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = buffer.length;
  const riffSize = 36 + dataSize;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, buffer]);
}

// Transcribers
async function transcribeWithMistral(wavBuffer, modelOverride = null) {
  const url = 'https://api.mistral.ai/v1/audio/transcriptions';
  const form = new (require('form-data'))();
  const model = modelOverride || DEFAULT_MISTRAL_MODEL;
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
  // Compatibility: also send under 'audio' key and include basic metadata
  form.append('audio', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
  form.append('encoding', 'wav');
  form.append('sample_rate', '48000');
  form.append('channels', '1');
  try {
    const resp = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        ...form.getHeaders(),
      },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    // Expect { text: '...' }
    return resp.data.text || '';
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.log('[STT] Mistral transcription error', { status, data });
    throw err;
  }
}

// Google path removed by request

async function transcribeRouted(userId, wavBuffer, modelOverride = null) {
  // Always Mistral per user request
  return await transcribeWithMistral(wavBuffer, modelOverride);
}

// Create an Opus->PCM stream for each user and chunk it by inactivity
function startUserCapture(receiver, userId, options = {}) {
  const {
    silenceDurationMs = 2000,
    minSpeechMs = 200,
    onChunkReady = async () => {},
    onCleanup = () => {},
  } = options;

  const SILENCE_MS = Math.max(1500, Math.min(15000, silenceDurationMs));
  const MIN_PCM_BYTES = Math.max(1, Math.floor(48000 * 2 * (minSpeechMs / 1000)));

  const opusStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
  });

  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
  const pcmStream = opusStream.pipe(decoder);

  const chunks = [];
  let totalBytes = 0;
  const startedAt = Date.now();
  let finished = false;
  let loggedStart = false;

  const finalize = async (reason) => {
    if (finished) return;
    finished = true;

    opusStream.removeAllListeners();
    pcmStream.removeAllListeners();
    try { opusStream.destroy(); } catch (_) {}

    const durationMs = Date.now() - startedAt;
    let wav = null;
    let pcmBytes = totalBytes;
    if (totalBytes >= MIN_PCM_BYTES) {
      const pcm = Buffer.concat(chunks);
      wav = pcmToWav(pcm);
      pcmBytes = pcm.length;
      console.log(`[STT] Finalizing capture for user ${userId} | pcmBytes=${pcm.length} | duration=${durationMs}ms | reason=${reason}`);
    } else if (totalBytes > 0) {
      console.log(`[STT] Discarded short capture for user ${userId} | pcmBytes=${totalBytes}`);
    }

    const meta = { reason, durationMs, pcmBytes, hadSpeech: !!wav };

    chunks.length = 0;
    totalBytes = 0;

    try { onCleanup(meta); } catch (_) {}

    if (wav) {
      try {
        await onChunkReady(wav, meta);
      } catch (err) {
        console.log('[STT] Error delivering chunk', { userId, error: err?.message });
      }
    }
  };

  pcmStream.on('data', (data) => {
    if (finished) return;
    if (!loggedStart) {
      loggedStart = true;
      console.log(`[STT] Started capture for user ${userId} | silenceWindow=${SILENCE_MS}ms`);
    }
    chunks.push(data);
    totalBytes += data.length;
  });

  opusStream.once('end', () => finalize('silence'));
  opusStream.once('close', () => finalize('closed'));
  opusStream.once('error', (err) => {
    console.log('[STT] Recorder stream error', { userId, error: err?.message });
    finalize('recorder-error');
  });
  decoder.once('error', (err) => {
    console.log('[STT] Decoder error', { userId, error: err?.message });
    finalize('decoder-error');
  });

  return {
    stop: (reason = 'manual-stop') => finalize(reason),
  };
}

async function ensureConnection(guild, voiceChannel) {
  let conn = getVoiceConnection(guild.id);
  if (conn) return conn;
  conn = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  return conn;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('speechtotext')
    .setDescription('Manage real-time speech-to-text (enable/disable)')
    .addSubcommand(sc => sc
      .setName('enable')
      .setDescription('Enable STT for a voice channel and post to an output channel')
      .addChannelOption(opt => opt
        .setName('input_channel')
        .setDescription('Voice channel to listen (required)')
        .setRequired(true))
      .addChannelOption(opt => opt
        .setName('output_channel')
        .setDescription('Text channel where transcripts will be posted')
        .setRequired(true))
    )
    .addSubcommand(sc => sc
      .setName('disable')
      .setDescription('Disable STT for this server and stop listening'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
      }

      // Prevent timeout while checking/joining voice
      try { if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}
      const sub = interaction.options.getSubcommand();
      if (sub === 'disable') {
        // Disable and tear down
        await STTSettings.findOneAndUpdate(
          { guildId: interaction.guildId },
          { $set: { enabled: false, updatedBy: interaction.user.id } },
          { upsert: true }
        );
        const sess = sessions.get(interaction.guildId);
        if (sess?.connection) { try { sess.connection.destroy(); } catch {} }
        sessions.delete(interaction.guildId);
        return interaction.editReply({ content: '🛑 STT disabled and voice session stopped.' });
      }

      // Enable flow
      const inputChannel = interaction.options.getChannel('input_channel');
      const outputChannel = interaction.options.getChannel('output_channel');
      const prev = await STTSettings.findOne({ guildId: interaction.guildId }).lean().catch(() => null);
      const chosenModel = prev?.model || DEFAULT_MISTRAL_MODEL;
      const silenceDurationMs = prev?.flushIntervalMs ? Math.max(1500, Math.min(15000, prev.flushIntervalMs)) : 2000;

      // Resolve voice channel to listen to
      let voiceChannel = null;
      if (inputChannel && inputChannel.type === ChannelType.GuildVoice) {
        voiceChannel = inputChannel;
      } else {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        voiceChannel = member.voice?.channel || null;
      }

      if (!voiceChannel) {
        return interaction.editReply({ content: 'No voice channel specified or joined. Join a voice channel or specify one.' });
      }

      // Permission checks
      const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
      const voicePerms = voiceChannel.permissionsFor(me);
      const missingVoice = [];
      if (!voicePerms?.has('ViewChannel')) missingVoice.push('ViewChannel');
      if (!voicePerms?.has('Connect')) missingVoice.push('Connect');
      if (missingVoice.length) {
        return interaction.editReply({ content: `I need these permissions in ${voiceChannel}: ${missingVoice.join(', ')}` });
      }

      const outPerms = outputChannel.permissionsFor(me);
      const missingOut = [];
      if (!outPerms?.has('ViewChannel')) missingOut.push('ViewChannel');
      if (!outPerms?.has('SendMessages')) missingOut.push('SendMessages');
      if (missingOut.length) {
        return interaction.editReply({ content: `I need these permissions in ${outputChannel}: ${missingOut.join(', ')}` });
      }

      // Persist settings (single active per guild)
      await STTSettings.findOneAndUpdate(
        { guildId: interaction.guildId },
        {
          $set: {
            enabled: true,
            inputChannelId: voiceChannel.id,
            outputChannelId: outputChannel.id,
            model: chosenModel,
            flushIntervalMs: silenceDurationMs,
            updatedBy: interaction.user.id,
          }
        },
        { upsert: true }
      );

      // Single active config per guild is enough; history can be added later if needed

      // Create or reuse a session per guild
      let sess = sessions.get(interaction.guildId);
      if (sess && sess.connection && sess.connection.joinConfig.channelId !== voiceChannel.id) {
        try { sess.connection.destroy(); } catch (_) {}
        sessions.delete(interaction.guildId);
        sess = null;
      }

      if (!sess) {
        const conn = await ensureConnection(interaction.guild, voiceChannel);
        sess = {
          connection: conn,
          outputChannelId: outputChannel.id,
          model: chosenModel,
          silenceDurationMs,
          streamsByUser: new Map(),
          pendingRestarts: new Set(),
        };
        sessions.set(interaction.guildId, sess);

        // Handle speaking events to attach receivers
        const receiver = conn.receiver;
        const ensureUserCapture = (userId, { allowQueue = true, source = 'start' } = {}) => {
          if (!sess.connection || sess.connection.state.status === VoiceConnectionStatus.Destroyed) return;
          if (sess.streamsByUser.has(userId)) {
            if (allowQueue) {
              if (!sess.pendingRestarts.has(userId)) {
                console.log(`[STT] Queuing restart for user ${userId} (${source}) while capture active`);
              }
              sess.pendingRestarts.add(userId);
            }
            return;
          }

          const capture = startUserCapture(receiver, userId, {
            silenceDurationMs: sess.silenceDurationMs,
            minSpeechMs: 200,
            onChunkReady: async (wav) => {
              try {
                const transcript = await transcribeRouted(userId, wav, sess.model);
                const trimmed = transcript?.trim();
                if (!trimmed) return;

                const user = await interaction.client.users.fetch(userId).catch(() => null);
                const name = user ? (user.globalName || user.username) : 'User';
                const chanFromCache = interaction.client.channels.cache.get(sess.outputChannelId);
                const out = chanFromCache || await interaction.client.channels.fetch(sess.outputChannelId).catch(() => null);
                if (out && out.isTextBased()) {
                  await out.send(`${name}: ${trimmed}`);
                }
              } catch (e) {
                console.log('[STT] Transcription pipeline error', { error: e?.message });
              }
            },
            onCleanup: (meta) => {
              sess.streamsByUser.delete(userId);
              if (meta?.reason === 'manual-stop') return;
              if (sess.pendingRestarts?.delete(userId)) {
                setImmediate(() => ensureUserCapture(userId, { allowQueue: false, source: 'queued-restart' }));
              }
            },
          });

          sess.streamsByUser.set(userId, capture);
        };

        receiver.speaking.on('start', (userId) => ensureUserCapture(userId));
      } else {
        // Update session config
        sess.outputChannelId = outputChannel.id;
        sess.model = chosenModel;
        sess.silenceDurationMs = silenceDurationMs;
      }

      await interaction.editReply({
        content: `✅ STT enabled. Listening in <#${voiceChannel.id}> and posting to <#${outputChannel.id}>.`,
      });
    } catch (err) {
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: '❌ Failed to start speech-to-text.' });
        } else if (!interaction.replied) {
          await interaction.reply({ content: '❌ Failed to start speech-to-text.', flags: MessageFlags.Ephemeral });
        }
      } catch (_) {}
    }
  },
  // Auto-resume helper usable from bot.js
  async resumeIfNeeded(client, guild) {
    try {
      const settings = await STTSettings.findOne({ guildId: guild.id, enabled: true }).lean();
      if (!settings?.inputChannelId || !settings?.outputChannelId) return;
      const voiceChannel = guild.channels.cache.get(settings.inputChannelId);
      const outputChannel = guild.channels.cache.get(settings.outputChannelId);
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice || !outputChannel) return;

      // Only run if members present
      const nonBotCount = voiceChannel.members.filter(m => !m.user.bot).size;
      if (nonBotCount === 0) return;

      // Reuse or create session
      let sess = sessions.get(guild.id);
      if (sess && sess.connection && sess.connection.joinConfig.channelId !== voiceChannel.id) {
        try { sess.connection.destroy(); } catch {}
        sessions.delete(guild.id);
        sess = null;
      }
      const chosenModel = settings.model || DEFAULT_MISTRAL_MODEL;
      const silenceDurationMs = settings.flushIntervalMs ? Math.max(1500, Math.min(15000, settings.flushIntervalMs)) : 2000;

      if (!sess) {
        const conn = await ensureConnection(guild, voiceChannel);
        sess = {
          connection: conn,
          outputChannelId: outputChannel.id,
          model: chosenModel,
          silenceDurationMs,
          streamsByUser: new Map(),
          pendingRestarts: new Set(),
          idleTimer: null,
        };
        sessions.set(guild.id, sess);

        // Attach receiver handlers
        const receiver = conn.receiver;
        const ensureUserCapture = (userId, { allowQueue = true, source = 'start' } = {}) => {
          if (sess.idleTimer) { try { clearTimeout(sess.idleTimer); } catch {} sess.idleTimer = null; }
          if (!sess.connection || sess.connection.state.status === VoiceConnectionStatus.Destroyed) return;
          if (sess.streamsByUser.has(userId)) {
            if (allowQueue) {
              if (!sess.pendingRestarts.has(userId)) {
                console.log(`[STT] Queuing restart for user ${userId} (${source}) while capture active`);
              }
              sess.pendingRestarts.add(userId);
            }
            return;
          }

          const capture = startUserCapture(receiver, userId, {
            silenceDurationMs: sess.silenceDurationMs,
            minSpeechMs: 200,
            onChunkReady: async (wav) => {
              try {
                const transcript = await transcribeRouted(userId, wav, sess.model);
                const trimmed = transcript?.trim();
                if (!trimmed) return;
                const chanFromCache = client.channels.cache.get(sess.outputChannelId);
                const out = chanFromCache || await client.channels.fetch(sess.outputChannelId).catch(() => null);
                if (!out || !out.isTextBased()) return;

                const member = await guild.members.fetch(userId).catch(() => null);
                const displayName = member ? member.displayName : null;
                const user = member?.user || await client.users.fetch(userId).catch(() => null);
                const name = displayName || user?.globalName || user?.username || 'User';
                await out.send(`${name}: ${trimmed}`);
              } catch (e) { console.log('[STT] Transcription pipeline error', { error: e?.message }); }
            },
            onCleanup: (meta) => {
              sess.streamsByUser.delete(userId);
              if (sess.streamsByUser.size === 0 && !sess.idleTimer) {
                sess.idleTimer = setTimeout(() => {
                  try { sess.connection.destroy(); } catch {}
                  sessions.delete(guild.id);
                  console.log('[STT] Auto-stopped due to inactivity');
                }, 60000).unref();
              }
              if (meta?.reason === 'manual-stop') return;
              if (sess.pendingRestarts?.delete(userId)) {
                setImmediate(() => ensureUserCapture(userId, { allowQueue: false, source: 'queued-restart' }));
              }
            },
          });

          sess.streamsByUser.set(userId, capture);
        };

        receiver.speaking.on('start', (userId) => ensureUserCapture(userId));
      }
    } catch (_) { /* ignore */ }
  }
};
