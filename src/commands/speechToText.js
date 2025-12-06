const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const STTSettings = require('../models/STTSettings');
const { processTranscription, createTranscriptionEmbed } = require('../services/voiceTranscriptionService');

// Configuration
const SILENCE_TIMEOUT_MS = 1000; // Stop recording after 1.0 second of silence (allow brief pauses)
const MIN_AUDIO_DURATION_MS = 400; // Minimum audio duration to process

// Logging control for STT subsystem. Set to `true` to enable verbose STT logs.
const STT_VERBOSE = false;
const sttLog = (...args) => {
  if (STT_VERBOSE) {
    console.log(...args);
  }
};

// Sensitivity tuning: small arming window to measure ambient level before committing to record.
// Increase VOICE_SENSITIVITY_THRESHOLD to be less sensitive (larger value), decrease to be more sensitive.
const ARM_WINDOW_MS = 300; // how long to sample before deciding if it's real speech
const VOICE_SENSITIVITY_THRESHOLD = 200; // RMS threshold for considering audio as speech (tweak as needed)

// Active sessions per guild (guildId -> GuildSession)
const sessions = new Map();

/**
 * Convert PCM buffer to WAV format
 */
function pcmToWav(pcmBuffer, sampleRate = 48000, numChannels = 1) {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  
  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Compute RMS for 16-bit PCM buffer (Int16LE)
 */
function computeRms(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length === 0) return 0;
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const s = pcmBuffer.readInt16LE(i * 2);
    sumSq += s * s;
  }
  const meanSq = sumSq / Math.max(1, sampleCount);
  return Math.sqrt(meanSq);
}

/**
 * Manages audio capture for a single user
 * Key insight: Don't destroy recorder between recordings - reuse it
 */
class UserRecorder {
  constructor(userId, session) {
    this.userId = userId;
    this.session = session;
    this.audioChunks = [];
    this.isRecording = false;
    this.silenceTimer = null;
    this.startTime = null;
    this.isProcessing = false;
    this.currentStream = null;
    this.decoder = null;
    // Pre-buffering / arming for noise thresholding
    this.prebufferChunks = [];
    this.arming = false;
    this.armTimer = null;
    this.armStart = null;
  }

  /**
   * Called when user starts speaking
   */
  onSpeakingStart() {
    // Clear any pending silence timer - user is speaking again
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
      sttLog(`[STT] User ${this.userId} resumed speaking, cleared silence timer`);
    }

    // If processing, we'll catch next speaking event
    if (this.isProcessing) {
      sttLog(`[STT] Ignoring speaking start for ${this.userId} - still processing`);
      return;
    }

    // If not recording, start a new recording (but use arming window to avoid background noise)
    if (!this.isRecording && !this.arming) {
      sttLog(`[STT] User ${this.userId} started speaking (arming)`);
      // Begin arming: create stream and sample briefly to decide if it's real speech
      this.arming = true;
      this.prebufferChunks = [];
      this.armStart = Date.now();
      // Create stream/decoder to capture audio into prebuffer
      this.createNewStream();
      // After ARM_WINDOW_MS evaluate rms
      this.armTimer = setTimeout(() => {
        try {
          const pcm = Buffer.concat(this.prebufferChunks || []);
          const rms = computeRms(pcm);
          if (rms >= VOICE_SENSITIVITY_THRESHOLD) {
            // Confirmed speech -> start recording and keep prebuffer
            this.isRecording = true;
            this.audioChunks = (this.prebufferChunks || []).slice();
            // approximate start time a bit earlier
            this.startTime = Date.now() - Math.min(ARM_WINDOW_MS, Date.now() - this.armStart);
            sttLog(`[STT] Arming confirmed for ${this.userId} (rms:${Math.round(rms)})`);
          } else {
            // Not speech -> cleanup
            try { if (this.currentStream) { this.currentStream.destroy(); this.currentStream = null; } } catch (e) {}
            this.cleanupDecoder();
            sttLog(`[STT] Arming rejected for ${this.userId} (rms:${Math.round(rms)})`);
          }
        } catch (e) {
          sttLog(`[STT] Arming eval error for ${this.userId}:`, e?.message || e);
        }
        this.arming = false;
        if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null; }
      }, ARM_WINDOW_MS);
    } else {
      // Already recording - just make sure stream is alive
      sttLog(`[STT] User ${this.userId} continued speaking`);
      // If stream died, recreate it
      if (!this.currentStream) {
        sttLog(`[STT] Recreating dead stream for ${this.userId}`);
        this.createNewStream();
      }
    }
  }

  /**
   * Called when user stops speaking
   */
  onSpeakingEnd() {
    // If we're still arming (deciding if speech), cancel arming
    if (this.arming) {
      if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null; }
      this.arming = false;
      this.prebufferChunks = [];
      try { if (this.currentStream) { this.currentStream.destroy(); this.currentStream = null; } } catch (e) {}
      this.cleanupDecoder();
      sttLog(`[STT] Arming cancelled for ${this.userId}`);
      return;
    }

    if (!this.isRecording) return;

    sttLog(`[STT] User ${this.userId} stopped speaking, waiting ${SILENCE_TIMEOUT_MS}ms before finalize`);

    // Mark stream as potentially dead
    this.hasActiveStream = false;

    // Start silence timer
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    this.silenceTimer = setTimeout(() => {
      sttLog(`[STT] Silence timeout reached for ${this.userId}, finalizing recording`);
      this.finalize();
    }, SILENCE_TIMEOUT_MS);
  }

  /**
   * Create a new audio stream (for initial or continued recording)
   */
  createNewStream() {
    // ALWAYS destroy old stream completely
    if (this.currentStream) {
      try {
        this.currentStream.unpipe();
        this.currentStream.removeAllListeners();
        this.currentStream.destroy();
      } catch (e) {}
      this.currentStream = null;
    }

    // ALWAYS create a fresh decoder - never reuse from previous stream
    try {
      if (this.decoder) {
        this.decoder.unpipe();
        this.decoder.removeAllListeners();
        this.decoder.destroy();
      }
    } catch (e) {}

    // Create brand new decoder
    this.decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 1,
      rate: 48000,
    });

    this.decoder.on('error', (err) => {
      sttLog(`[STT] Decoder error for ${this.userId}:`, err?.message);
    });

    this.decoder.on('data', (chunk) => {
      if (!chunk || chunk.length === 0) return;
      // While arming, collect into prebuffer for RMS evaluation
      if (this.arming) {
        this.prebufferChunks.push(Buffer.from(chunk));
      }
      // If already recording, append to main audio buffer
      if (this.isRecording) {
        this.audioChunks.push(Buffer.from(chunk));
      }
    });

    // Subscribe to user's audio
    try {
      // Use behavior 0 (manual end) to have full control over stream lifetime
      this.currentStream = this.session.receiver.subscribe(this.userId, {
        end: {
          behavior: 0, // Manual - we control when it ends
        },
      });

      this.currentStream.on('error', (err) => {
        if (!err?.message?.includes('DAVE')) {
          sttLog(`[STT] Stream error for ${this.userId}:`, err?.message);
        }
      });

      // Pipe to decoder
      this.currentStream.pipe(this.decoder);
      
      sttLog(`[STT] Created new audio stream for ${this.userId} (manual end)`);

    } catch (err) {
      sttLog(`[STT] Failed to create stream for ${this.userId}:`, err?.message);
    }
  }

  /**
   * Start a new recording session
   */
  startRecording() {
    if (this.isRecording) {
      sttLog(`[STT] Recording already active for ${this.userId}, skipping start`);
      return;
    }

    this.isRecording = true;
    this.audioChunks = [];
    this.startTime = Date.now();

    // Clean up old stream only (not decoder, we'll create fresh one immediately)
    if (this.currentStream) {
      try {
        this.currentStream.unpipe();
        this.currentStream.removeAllListeners();
        this.currentStream.destroy();
      } catch (e) {}
      this.currentStream = null;
    }

    // Create new stream and decoder immediately
    this.createNewStream();

    sttLog(`[STT] Started recording for user ${this.userId}`);
  }

  /**
   * Finalize recording and send for transcription
   */
  async finalize() {
    if (!this.isRecording || this.isProcessing) {
      sttLog(`[STT] Skipping finalize for ${this.userId} - isRecording:${this.isRecording}, isProcessing:${this.isProcessing}`);
      return;
    }

    this.isRecording = false;
    this.isProcessing = true;

    // Clear silence timer
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    // End the current stream manually (since we're using behavior: 0)
    if (this.currentStream) {
      try {
        this.currentStream.destroy();
      } catch (e) {}
      this.currentStream = null;
    }

    const duration = Date.now() - this.startTime;
    
    // Wait for any pending data
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Copy chunks
    const chunks = this.audioChunks.slice();
    const chunkCount = chunks.length;
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    
    // Cleanup decoder for next recording
    this.cleanupDecoder();

    sttLog(`[STT] Finalizing for ${this.userId} - duration:${duration}ms, chunks:${chunkCount}, bytes:${totalBytes}`);

    // Check if we have audio data
    if (chunkCount === 0 || totalBytes === 0) {
      sttLog(`[STT] Discarded audio for ${this.userId} - no data received (${duration}ms, ${chunkCount} chunks)`);
      this.isProcessing = false;
      return;
    }

    if (duration < MIN_AUDIO_DURATION_MS) {
      sttLog(`[STT] Discarded short audio for ${this.userId} (${duration}ms, ${totalBytes} bytes)`);
      this.isProcessing = false;
      return;
    }

    // Combine chunks and convert to WAV
    const pcmBuffer = Buffer.concat(chunks);
    const wavBuffer = pcmToWav(pcmBuffer);

    sttLog(`[STT] Finalized recording for ${this.userId} | ${duration}ms | ${wavBuffer.length} bytes | ${chunkCount} chunks`);

    // Process transcription
    try {
      await this.session.processAudio(this.userId, wavBuffer);
    } catch (err) {
      sttLog(`[STT] Transcription error for ${this.userId}:`, err?.message);
    }

    this.isProcessing = false;
  }

  /**
   * Cleanup decoder only
   */
  cleanupDecoder() {
    if (this.decoder) {
      try {
        this.decoder.removeAllListeners();
        this.decoder.destroy();
      } catch (e) {}
      this.decoder = null;
    }
  }

  /**
   * Cleanup all streams
   */
  cleanupAll() {
    this.audioChunks = [];
    this.prebufferChunks = [];
    if (this.armTimer) {
      clearTimeout(this.armTimer);
      this.armTimer = null;
    }
    this.arming = false;

    if (this.currentStream) {
      try {
        this.currentStream.unpipe();
        this.currentStream.removeAllListeners();
        this.currentStream.destroy();
      } catch (e) {}
      this.currentStream = null;
    }

    this.cleanupDecoder();
  }

  /**
   * Force stop
   */
  stop() {
    this.isRecording = false;
    this.isProcessing = false;
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    if (this.armTimer) {
      clearTimeout(this.armTimer);
      this.armTimer = null;
    }
    this.arming = false;
    this.prebufferChunks = [];

    this.cleanupAll();
  }
}

/**
 * Manages voice transcription session for a guild
 */
class GuildSession {
  constructor(options) {
    this.guildId = options.guildId;
    this.guild = options.guild;
    this.connection = options.connection;
    this.receiver = options.connection.receiver;
    this.outputChannelId = options.outputChannelId;
    this.client = options.client;
    
    this.language1 = options.language1 || null;
    this.language2 = options.language2 || null;
    this.language3 = options.language3 || null;

    this.userRecorders = new Map();
    this.idleTimer = null;
    this.isDestroyed = false;

    this.setupSpeakingListeners();
  }

  /**
   * Setup speaking event listeners
   */
  setupSpeakingListeners() {
    // Handle speaking start
    this.onSpeakingStart = (userId) => {
      if (this.isDestroyed) return;
      
      // Get or create recorder for this user
      let recorder = this.userRecorders.get(userId);
      if (!recorder) {
        recorder = new UserRecorder(userId, this);
        this.userRecorders.set(userId, recorder);
      }

      // Cancel idle timer
      this.cancelIdleTimer();

      recorder.onSpeakingStart();
    };

    // Handle speaking end
    this.onSpeakingEnd = (userId) => {
      if (this.isDestroyed) return;

      const recorder = this.userRecorders.get(userId);
      if (recorder) {
        recorder.onSpeakingEnd();
      }

      // Check if anyone is still speaking
      this.checkIdleState();
    };

    this.receiver.speaking.on('start', this.onSpeakingStart);
    this.receiver.speaking.on('end', this.onSpeakingEnd);
  }

  /**
   * Check if session is idle and schedule shutdown if needed
   */
  checkIdleState() {
    // Check if any user is actively recording
    let anyActive = false;
    for (const recorder of this.userRecorders.values()) {
      if (recorder.isRecording || recorder.isProcessing) {
        anyActive = true;
        break;
      }
    }

    if (!anyActive) {
      this.scheduleIdleShutdown();
    }
  }

  /**
   * Schedule idle shutdown
   */
  scheduleIdleShutdown() {
    if (this.idleTimer) return;

    // Check if voice channel is now empty
    this.idleTimer = setTimeout(async () => {
      try {
        // Check if anyone is still in the voice channel
        const channelId = this.connection?.joinConfig?.channelId;
        if (channelId) {
          const voiceChannel = this.guild.channels.cache.get(channelId);
          if (voiceChannel) {
            const memberCount = voiceChannel.members.filter(m => !m.user.bot).size;
            if (memberCount > 0) {
              // Users still present, don't shut down
              console.log(`[STT] Idle check: ${memberCount} user(s) still in ${voiceChannel.name}, keeping session alive`);
              return;
            }
          }
        }
        
        console.log(`[STT] Voice channel empty, destroying session for guild ${this.guildId}`);
        this.destroy();
        sessions.delete(this.guildId);
      } catch (err) {
        console.log(`[STT] Idle shutdown check error:`, err?.message);
        // On error, destroy anyway
        this.destroy();
        sessions.delete(this.guildId);
      }
    }, 120000); // 2 minutes idle timeout
  }

  /**
   * Cancel idle shutdown timer
   */
  cancelIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Check if voice channel is empty and leave immediately if so
   */
  async checkVoiceChannelOccupancy() {
    try {
      const channelId = this.connection?.joinConfig?.channelId;
      if (!channelId) return;

      const voiceChannel = this.guild.channels.cache.get(channelId);
      if (!voiceChannel) {
        console.log(`[STT] Voice channel not found, destroying session`);
        this.destroy();
        sessions.delete(this.guildId);
        return;
      }

      const memberCount = voiceChannel.members.filter(m => !m.user.bot).size;
      if (memberCount === 0) {
        console.log(`[STT] Voice channel ${voiceChannel.name} is now empty, leaving immediately`);
        this.destroy();
        sessions.delete(this.guildId);
      }
    } catch (err) {
      console.log(`[STT] Error checking voice channel occupancy:`, err?.message);
    }
  }

  /**
   * Process transcribed audio
   */
  async processAudio(userId, wavBuffer) {
    try {
      // Get transcription with translations
      const result = await processTranscription(wavBuffer, {
        language1: this.language1,
        language2: this.language2,
        language3: this.language3,
      });

      if (!result || !result.original?.text?.trim()) {
        return;
      }

      // Get user info
      let displayName = 'User';
      let avatar = null;

      try {
        const member = await this.guild.members.fetch(userId);
        displayName = member.displayName || member.user.globalName || member.user.username;
        avatar = member.user.displayAvatarURL({ dynamic: true, size: 64 });
      } catch (e) {
        try {
          const user = await this.client.users.fetch(userId);
          displayName = user.globalName || user.username;
          avatar = user.displayAvatarURL({ dynamic: true, size: 64 });
        } catch (e2) {}
      }

      // Resolve output channel. Allow the stored output to be a voice channel ID
      // by attempting to find a suitable text channel to post into.
      let outputChannel = this.client.channels.cache.get(this.outputChannelId)
        || await this.client.channels.fetch(this.outputChannelId).catch(() => null);

      // If user selected a voice channel as the output, try to resolve a nearby text channel:
      // 1) Text channel with the same name
      // 2) Any text channel in the same category (parentId)
      // 3) First text channel in the guild where the bot can send messages
      if (outputChannel && !outputChannel?.isTextBased()) {
        try {
          const voiceChannel = this.guild.channels.cache.get(outputChannel.id);
          let candidate = null;

          if (voiceChannel) {
            // 1) same name
            candidate = this.guild.channels.cache.find(c => c.isTextBased() && c.name === voiceChannel.name);

            // 2) same category
            if (!candidate && voiceChannel.parentId) {
              candidate = this.guild.channels.cache.find(c => c.isTextBased() && c.parentId === voiceChannel.parentId);
            }
          }

          // 3) fallback: first text channel where the bot can send messages
          if (!candidate) {
            candidate = this.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(this.client.user)?.has('SendMessages'));
          }

          if (candidate) {
            outputChannel = candidate;
            console.log(`[STT] Resolved voice-channel output to text channel ${outputChannel.name} for guild ${this.guildId}`);
          } else {
            console.log(`[STT] No text channel found to post transcriptions for guild ${this.guildId}`);
            return;
          }
        } catch (e) {
          console.log(`[STT] Error resolving output channel for ${this.guildId}:`, e?.message);
          return;
        }
      }

      if (!outputChannel || !outputChannel.isTextBased()) {
        console.log(`[STT] Output channel unavailable: ${this.outputChannelId}`);
        return;
      }

      // Send transcription embed
      const embed = createTranscriptionEmbed(result, displayName, avatar);
      await outputChannel.send({ embeds: [embed] });

      console.log(`[STT] Transcription sent for ${displayName}: "${result.original.text.substring(0, 50)}..."`);

    } catch (err) {
      console.log(`[STT] Process audio error:`, err?.message);
    }
  }

  /**
   * Update language settings
   */
  updateSettings(options) {
    if (options.language1 !== undefined) this.language1 = options.language1;
    if (options.language2 !== undefined) this.language2 = options.language2;
    if (options.language3 !== undefined) this.language3 = options.language3;
    if (options.outputChannelId) this.outputChannelId = options.outputChannelId;
  }

  /**
   * Destroy session and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Remove speaking listeners
    this.receiver.speaking.off('start', this.onSpeakingStart);
    this.receiver.speaking.off('end', this.onSpeakingEnd);

    // Stop all recorders
    for (const recorder of this.userRecorders.values()) {
      recorder.stop();
    }
    this.userRecorders.clear();

    // Cancel idle timer
    this.cancelIdleTimer();

    // Destroy voice connection
    try {
      this.connection.destroy();
    } catch (e) {}

    console.log(`[STT] Session destroyed for guild ${this.guildId}`);
  }
}

// Language choices
const LANGUAGE_CHOICES = [
  { name: 'English', value: 'en' },
  { name: 'Spanish', value: 'es' },
  { name: 'French', value: 'fr' },
  { name: 'German', value: 'de' },
  { name: 'Italian', value: 'it' },
  { name: 'Portuguese', value: 'pt' },
  { name: 'Russian', value: 'ru' },
  { name: 'Japanese', value: 'ja' },
  { name: 'Korean', value: 'ko' },
  { name: 'Chinese', value: 'zh' },
  { name: 'Arabic', value: 'ar' },
  { name: 'Hindi', value: 'hi' },
  { name: 'Urdu', value: 'ur' },
  { name: 'Turkish', value: 'tr' },
  { name: 'Dutch', value: 'nl' },
  { name: 'Polish', value: 'pl' },
  { name: 'Ukrainian', value: 'uk' },
  { name: 'Vietnamese', value: 'vi' },
  { name: 'Thai', value: 'th' },
  { name: 'Indonesian', value: 'id' },
  { name: 'Filipino', value: 'tl' },
  { name: 'Greek', value: 'el' },
  { name: 'Hebrew', value: 'he' },
  { name: 'Persian', value: 'fa' },
  { name: 'Bengali', value: 'bn' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('speechtotext')
    .setDescription('Real-time voice transcription with optional translation')
    .addSubcommand(sub => sub
      .setName('enable')
      .setDescription('Enable voice transcription')
      .addChannelOption(opt => opt
        .setName('voice_channel')
        .setDescription('Voice channel to listen to')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true))
      .addChannelOption(opt => opt
        .setName('output_channel')
        .setDescription('Channel to post transcriptions')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('language1')
        .setDescription('First translation language (optional)')
        .addChoices(...LANGUAGE_CHOICES))
      .addStringOption(opt => opt
        .setName('language2')
        .setDescription('Second translation language (optional)')
        .addChoices(...LANGUAGE_CHOICES))
      .addStringOption(opt => opt
        .setName('language3')
        .setDescription('Third translation language (optional)')
        .addChoices(...LANGUAGE_CHOICES)))
    .addSubcommand(sub => sub
      .setName('disable')
      .setDescription('Disable voice transcription'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ 
        content: '❌ This command can only be used in a server.', 
        flags: MessageFlags.Ephemeral 
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'disable') {
      return this.handleDisable(interaction);
    }

    return this.handleEnable(interaction);
  },

  async handleDisable(interaction) {
    // Update database
    await STTSettings.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { enabled: false, updatedBy: interaction.user.id } },
      { upsert: true }
    );

    // Destroy session
    const session = sessions.get(interaction.guildId);
    if (session) {
      session.destroy();
      sessions.delete(interaction.guildId);
    }

    return interaction.editReply({ content: '🛑 Voice transcription disabled.' });
  },

  async handleEnable(interaction) {
    const voiceChannel = interaction.options.getChannel('voice_channel');
    const outputChannel = interaction.options.getChannel('output_channel');
    const language1 = interaction.options.getString('language1') || null;
    const language2 = interaction.options.getString('language2') || null;
    const language3 = interaction.options.getString('language3') || null;

    // Check permissions
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    
    const voicePerms = voiceChannel.permissionsFor(me);
    if (!voicePerms?.has('Connect') || !voicePerms?.has('ViewChannel')) {
      return interaction.editReply({ 
        content: `❌ I need \`Connect\` and \`View Channel\` permissions in ${voiceChannel}.` 
      });
    }

    const outPerms = outputChannel.permissionsFor(me);
    if (!outPerms?.has('SendMessages') || !outPerms?.has('ViewChannel')) {
      return interaction.editReply({ 
        content: `❌ I need \`Send Messages\` and \`View Channel\` permissions in ${outputChannel}.` 
      });
    }

    // Save to database
    await STTSettings.findOneAndUpdate(
      { guildId: interaction.guildId },
      {
        $set: {
          enabled: true,
          inputChannelId: voiceChannel.id,
          outputChannelId: outputChannel.id,
          language1,
          language2,
          language3,
          updatedBy: interaction.user.id,
        }
      },
      { upsert: true }
    );

    // Check existing session
    let session = sessions.get(interaction.guildId);

    if (session) {
      // If different voice channel, destroy and recreate
      if (session.connection.joinConfig.channelId !== voiceChannel.id) {
        session.destroy();
        sessions.delete(interaction.guildId);
        session = null;
      } else {
        // Update settings
        session.updateSettings({
          language1,
          language2,
          language3,
          outputChannelId: outputChannel.id,
        });
      }
    }

    // Create new session if needed
    if (!session) {
      try {
        // Get or create connection
        let connection = getVoiceConnection(interaction.guildId);
        
        if (!connection) {
          connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
          });
          
          await entersState(connection, VoiceConnectionStatus.Ready, 20000);
        }

        session = new GuildSession({
          guildId: interaction.guildId,
          guild: interaction.guild,
          connection,
          outputChannelId: outputChannel.id,
          client: interaction.client,
          language1,
          language2,
          language3,
        });

        sessions.set(interaction.guildId, session);

      } catch (err) {
        console.error('[STT] Failed to create session:', err);
        return interaction.editReply({ 
          content: '❌ Failed to join voice channel. Please try again.' 
        });
      }
    }

    // Build response
    const langs = [language1, language2, language3].filter(Boolean);
    const langText = langs.length > 0
      ? `\n📝 **Translations:** ${langs.map(l => `\`${l}\``).join(', ')}`
      : '\n📝 **Translations:** None (original only)';

    return interaction.editReply({
      content: `✅ **Voice transcription enabled!**\n\n🎤 **Listening:** ${voiceChannel}\n💬 **Output:** ${outputChannel}${langText}\n\n*I'll transcribe after 1 second of silence.*`
    });
  },

  /**
   * Resume/manage sessions based on voice channel occupancy
   * Automatically joins when users are present, leaves when empty
   */
  async resumeIfNeeded(client, guild) {
    try {
      const settings = await STTSettings.findOne({ 
        guildId: guild.id, 
        enabled: true 
      }).lean();

      if (!settings?.inputChannelId || !settings?.outputChannelId) {
        // No settings, but check if we have an active session to clean up
        const existingSession = sessions.get(guild.id);
        if (existingSession) {
          console.log(`[STT] No settings found, destroying orphaned session for ${guild.id}`);
          existingSession.destroy();
          sessions.delete(guild.id);
        }
        return;
      }

      const voiceChannel = guild.channels.cache.get(settings.inputChannelId);
      const outputChannel = guild.channels.cache.get(settings.outputChannelId);

      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        // Voice channel not found or invalid
        const existingSession = sessions.get(guild.id);
        if (existingSession) {
          console.log(`[STT] Voice channel unavailable, destroying session for ${guild.id}`);
          existingSession.destroy();
          sessions.delete(guild.id);
        }
        return;
      }

      if (!outputChannel) {
        // Output channel not found
        const existingSession = sessions.get(guild.id);
        if (existingSession) {
          console.log(`[STT] Output channel unavailable, destroying session for ${guild.id}`);
          existingSession.destroy();
          sessions.delete(guild.id);
        }
        return;
      }

      // Count non-bot members in the voice channel
      const memberCount = voiceChannel.members.filter(m => !m.user.bot).size;
      const existingSession = sessions.get(guild.id);

      if (memberCount === 0) {
        // No users in channel - destroy session if it exists
        if (existingSession) {
          console.log(`[STT] Voice channel empty, leaving and destroying session for ${guild.name}`);
          existingSession.destroy();
          sessions.delete(guild.id);
        }
        return;
      }

      // Users present in channel
      if (existingSession) {
        // Session already exists - verify it's connected to the right channel
        if (existingSession.connection?.joinConfig?.channelId !== voiceChannel.id) {
          // Connected to wrong channel, recreate
          console.log(`[STT] Wrong channel, recreating session for ${guild.name}`);
          existingSession.destroy();
          sessions.delete(guild.id);
        } else {
          // Session exists and is in the right channel - all good
          return;
        }
      }

      // No session exists but users are present - create one
      // Use a creation lock to prevent race conditions
      if (!this._creatingSession) this._creatingSession = new Set();
      
      if (this._creatingSession.has(guild.id)) {
        console.log(`[STT] Already creating session for ${guild.id}, skipping duplicate`);
        return;
      }

      this._creatingSession.add(guild.id);

      try {
        // Double-check no session was created while we were waiting
        if (sessions.has(guild.id)) {
          console.log(`[STT] Session created by another call, aborting duplicate creation`);
          return;
        }

        // Get or create connection
        let connection = getVoiceConnection(guild.id);
        
        if (!connection) {
          console.log(`[STT] Joining voice channel for ${guild.name} (${memberCount} user${memberCount > 1 ? 's' : ''} present)`);
          
          connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
          });

          await entersState(connection, VoiceConnectionStatus.Ready, 20000);
        }

        // Final race condition check
        if (sessions.has(guild.id)) {
          console.log(`[STT] Race condition detected, destroying duplicate connection`);
          try { connection.destroy(); } catch (e) {}
          return;
        }

        const session = new GuildSession({
          guildId: guild.id,
          guild,
          connection,
          outputChannelId: settings.outputChannelId,
          client,
          language1: settings.language1,
          language2: settings.language2,
          language3: settings.language3,
        });

        sessions.set(guild.id, session);
        console.log(`[STT] Started session for ${guild.name} in ${voiceChannel.name}`);

      } catch (err) {
        console.log(`[STT] Failed to create session for ${guild.id}:`, err?.message);
      } finally {
        // Always remove the creation lock
        this._creatingSession.delete(guild.id);
      }

    } catch (err) {
      console.log(`[STT] Resume check failed for ${guild.id}:`, err?.message);
    }
  },

  getSessions() {
    return sessions;
  },

  /**
   * Handle voice state updates - check if we need to join or leave
   */
  async handleVoiceStateUpdate(client, oldState, newState) {
    try {
      const guild = newState?.guild || oldState?.guild;
      if (!guild) return;

      // Ignore bot's own voice state changes to prevent loops
      const userId = newState?.id || oldState?.id;
      if (userId === client.user.id) {
        return;
      }

      // Get settings for this guild
      const settings = await STTSettings.findOne({ 
        guildId: guild.id, 
        enabled: true 
      }).lean();

      if (!settings?.inputChannelId) return;

      // Check if the state change affects our monitored voice channel
      const affectsOurChannel = 
        oldState?.channelId === settings.inputChannelId ||
        newState?.channelId === settings.inputChannelId;

      if (!affectsOurChannel) return;

      // Debounce: wait a bit to avoid race conditions from multiple rapid events
      const debounceKey = `${guild.id}_voiceUpdate`;
      if (this._debounceTimers?.[debounceKey]) {
        clearTimeout(this._debounceTimers[debounceKey]);
      }

      if (!this._debounceTimers) this._debounceTimers = {};
      
      this._debounceTimers[debounceKey] = setTimeout(async () => {
        delete this._debounceTimers[debounceKey];
        
        try {
          // Get fresh voice channel state
          const voiceChannel = guild.channels.cache.get(settings.inputChannelId);
          if (!voiceChannel) return;

          const memberCount = voiceChannel.members.filter(m => !m.user.bot).size;
          const session = sessions.get(guild.id);

          if (memberCount === 0) {
            // Channel is empty - destroy session if exists
            if (session) {
              console.log(`[STT] Voice channel ${voiceChannel.name} empty (last user left), leaving`);
              session.destroy();
              sessions.delete(guild.id);
            }
          } else {
            // Channel has users - ensure we're joined
            if (!session) {
              console.log(`[STT] User in ${voiceChannel.name}, joining (${memberCount} user${memberCount > 1 ? 's' : ''})`);
              await this.resumeIfNeeded(client, guild);
            }
          }
        } catch (err) {
          console.log(`[STT] Debounced voice state handler error:`, err?.message);
        }
      }, 500); // 500ms debounce

    } catch (err) {
      console.log(`[STT] Voice state update handler error:`, err?.message);
    }
  }
};
