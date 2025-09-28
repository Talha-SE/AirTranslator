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
function startUserCapture(receiver, userId, onSegment, timedFlushMs = 5000) {
  const opusStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }, // 1.0s silence closes (more sensitive)
  });

  // Decode to PCM S16LE 48kHz mono directly
  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });

  const chunks = [];
  let totalBytes = 0;
  const MAX_BYTES = 48000 * 2 * 120; // ~120s cap to allow long utterances
  const TIMED_FLUSH_MS = Math.max(1500, Math.min(15000, timedFlushMs)); // clamp 1.5s-15s
  let lastFlushAt = Date.now();
  let segmentStartAt = Date.now();

  const pcmStream = opusStream.pipe(decoder);
  pcmStream.on('data', (data) => {
    chunks.push(data);
    totalBytes += data.length;
    // Timed flush for real-time partials
    const now = Date.now();
    if (now - lastFlushAt >= TIMED_FLUSH_MS) {
      pcmStream.emit('segment');
      lastFlushAt = now;
    }
    if (totalBytes >= MAX_BYTES) {
      pcmStream.emit('segment');
    }
  });
  const flush = async () => {
    if (chunks.length === 0) return;
    const pcm = Buffer.concat(chunks);
    chunks.length = 0;
    totalBytes = 0;
    if (pcm.length < 48000 * 2 * 0.5) return; // ignore <0.5s
    const wav = pcmToWav(pcm);
    const started = Date.now();
    console.log(`[STT] Flushing segment for user ${userId} | pcmBytes=${pcm.length} | durSinceSegStart=${started - segmentStartAt}ms`);
    try {
      await onSegment(wav);
      const ended = Date.now();
      console.log(`[STT] Segment transcribed for user ${userId} in ${ended - started}ms`);
    } catch (e) {
      // timing already logged before; errors logged upstream
    } finally {
      segmentStartAt = Date.now();
    }
  };
  pcmStream.once('end', flush);
  pcmStream.on('segment', flush);

  // Safety: auto-close after 30s inactivity
  const inactivity = setTimeout(() => {
    try { opusStream.destroy(); } catch (_) {}
  }, 30000).unref();

  // Periodic timer to force flush regardless of new data (if stream stalls but not ended)
  const periodic = setInterval(() => {
    if (chunks.length > 0) {
      pcmStream.emit('segment');
    }
  }, TIMED_FLUSH_MS).unref();

  opusStream.on('end', () => { clearTimeout(inactivity); clearInterval(periodic); });
  opusStream.on('error', () => { clearTimeout(inactivity); clearInterval(periodic); });

  return { stop: () => { try { opusStream.destroy(); } catch (_) {} } };
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
      const flushIntervalMs = prev?.flushIntervalMs ? Math.max(1500, Math.min(15000, prev.flushIntervalMs)) : 3000;

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
            flushIntervalMs,
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
          flushIntervalMs,
          streamsByUser: new Map(),
          transcriptsByUser: new Map(), // userId -> [segments]
        };
        sessions.set(interaction.guildId, sess);

        // Handle speaking events to attach receivers
        const receiver = conn.receiver;
        receiver.speaking.on('start', (userId) => {
          if (sess.streamsByUser.has(userId)) return;
          const capture = startUserCapture(receiver, userId, async (wav) => {
            try {
              const transcript = await transcribeRouted(userId, wav, sess.model);
              if (!transcript) return;
              // Accumulate for final combined transcript
              const arr = sess.transcriptsByUser.get(userId) || [];
              arr.push(transcript);
              sess.transcriptsByUser.set(userId, arr);
              // Do not send partials; only send once on speaking end
            } catch (e) {
              console.log('[STT] Transcription pipeline error', { error: e?.message });
            }
          }, sess.flushIntervalMs);
          sess.streamsByUser.set(userId, capture);
        });
        receiver.speaking.on('end', async (userId) => {
          const c = sess.streamsByUser.get(userId);
          if (c) { try { c.stop(); } catch (_) {} }
          sess.streamsByUser.delete(userId);
          // Post a combined transcript for completeness
          const combined = (sess.transcriptsByUser.get(userId) || []).join('\n').trim();
          sess.transcriptsByUser.delete(userId);
          if (combined) {
            try {
              const user = await interaction.client.users.fetch(userId).catch(() => null);
              const name = user ? `${user.username}` : `User ${userId}`;
              const out = await interaction.client.channels.fetch(sess.outputChannelId).catch(() => null);
              if (out && out.isTextBased()) {
                await out.send(`${combined}`);
              }
            } catch (e) {
              console.log('[STT] Failed to send combined transcript', { error: e?.message });
            }
          }
        });
      } else {
        // Update session config
        sess.outputChannelId = outputChannel.id;
        sess.model = chosenModel;
        sess.flushIntervalMs = flushIntervalMs;
        if (!sess.transcriptsByUser) sess.transcriptsByUser = new Map();
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
      const flushIntervalMs = settings.flushIntervalMs ? Math.max(1500, Math.min(15000, settings.flushIntervalMs)) : 5000;

      if (!sess) {
        const conn = await ensureConnection(guild, voiceChannel);
        sess = {
          connection: conn,
          outputChannelId: outputChannel.id,
          model: chosenModel,
          flushIntervalMs,
          streamsByUser: new Map(),
          transcriptsByUser: new Map(),
          idleTimer: null,
        };
        sessions.set(guild.id, sess);

        // Attach receiver handlers
        const receiver = conn.receiver;
        receiver.speaking.on('start', (userId) => {
          if (sess.idleTimer) { try { clearTimeout(sess.idleTimer); } catch {} sess.idleTimer = null; }
          if (sess.streamsByUser.has(userId)) return;
          const capture = startUserCapture(receiver, userId, async (wav) => {
            try {
              const transcript = await transcribeRouted(userId, wav, sess.model);
              if (!transcript) return;
              const arr = sess.transcriptsByUser.get(userId) || [];
              arr.push(transcript);
              sess.transcriptsByUser.set(userId, arr);
            } catch (e) { console.log('[STT] Transcription pipeline error', { error: e?.message }); }
          }, sess.flushIntervalMs);
          sess.streamsByUser.set(userId, capture);
        });
        receiver.speaking.on('end', async (userId) => {
          const c = sess.streamsByUser.get(userId);
          if (c) { try { c.stop(); } catch {} }
          sess.streamsByUser.delete(userId);
          const combined = (sess.transcriptsByUser.get(userId) || []).join('\n').trim();
          sess.transcriptsByUser.delete(userId);
          if (combined) {
            try {
              const out = await client.channels.fetch(sess.outputChannelId).catch(() => null);
              if (out && out.isTextBased()) await out.send(`${combined}`);
            } catch (e) { console.log('[STT] Failed to send combined transcript', { error: e?.message }); }
          }
          if (sess.streamsByUser.size === 0 && !sess.idleTimer) {
            sess.idleTimer = setTimeout(() => {
              try { sess.connection.destroy(); } catch {}
              sessions.delete(guild.id);
              console.log('[STT] Auto-stopped due to inactivity');
            }, 60000).unref();
          }
        });
      }
    } catch (_) { /* ignore */ }
  }
};
