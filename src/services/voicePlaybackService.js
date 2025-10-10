const { createAudioPlayer, createAudioResource, joinVoiceChannel, NoSubscriberBehavior, VoiceConnectionStatus, entersState, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { Readable } = require('stream');
const prism = require('prism-media');
const ffmpegStatic = require('ffmpeg-static');

// Minimal WAV parser for PCM format
function parseWavPcm(buffer) {
  try {
    if (buffer.length < 44) return null;
    if (buffer.readUInt32BE(0) !== 0x52494646) return null; // 'RIFF'
    if (buffer.readUInt32BE(8) !== 0x57415645) return null; // 'WAVE'
    let offset = 12;
    let fmtChunk = null;
    let dataChunk = null;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      const next = offset + 8 + size;
      if (id === 'fmt ') {
        fmtChunk = {
          audioFormat: buffer.readUInt16LE(offset + 8),
          numChannels: buffer.readUInt16LE(offset + 10),
          sampleRate: buffer.readUInt32LE(offset + 12),
          byteRate: buffer.readUInt32LE(offset + 16),
          blockAlign: buffer.readUInt16LE(offset + 20),
          bitsPerSample: buffer.readUInt16LE(offset + 22),
        };
      } else if (id === 'data') {
        dataChunk = {
          start: offset + 8,
          length: size,
        };
      }
      offset = next;
    }
    if (!fmtChunk || !dataChunk) return null;
    return {
      ...fmtChunk,
      pcm: buffer.subarray(dataChunk.start, dataChunk.start + dataChunk.length),
    };
  } catch {
    return null;
  }
}

function bufferToStream(buffer) {
  const readable = new Readable({ read() {} });
  readable.push(buffer);
  readable.push(null);
  return readable;
}

async function ensureConnection(voiceChannel) {
  console.log('[Voice] Joining voice channel', {
    guildId: voiceChannel.guild.id,
    channelId: voiceChannel.id,
    channelName: voiceChannel.name,
  });
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  // Wait for connecting then ready with generous timeouts to reduce AbortError
  try {
    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      console.log('[Voice] Waiting for Connecting state...');
      await entersState(connection, VoiceConnectionStatus.Connecting, 10_000);
      console.log('[Voice] Connected, waiting for Ready state...');
      await entersState(connection, VoiceConnectionStatus.Ready, 25_000);
      console.log('[Voice] Connection Ready');
    }
  } catch (err) {
    console.error('[Voice] Connection failed or timed out:', err);
    try { connection.destroy(); } catch {}
    throw err;
  }

  try {
    // Extra logging for voice connection state transitions
    connection.on('stateChange', (oldS, newS) => {
      console.log('[Voice] Connection state:', oldS.status, '=>', newS.status);
    });
  } catch {}

  return connection;
}

// Enhanced debug logger
const debugLog = (stage, data) => {
  const logData = {
    timestamp: new Date().toISOString(),
    stage,
    ...data
  };
  console.log('[Voice Debug]', JSON.stringify(logData, null, 2));
};

async function createPcmResourceFrom(buffer) {
  const inBytes = buffer?.length || 0;
  // Try WAV passthrough first (no encoding/transcoding) if already 48kHz stereo 16-bit PCM
  const wav = parseWavPcm(buffer);
  if (wav && wav.audioFormat === 1 && wav.bitsPerSample === 16 && wav.sampleRate === 48000 && wav.numChannels === 2) {
    // Native path: feed raw PCM s16le 48k stereo to Discord (no container). This ensures proper pacing by the library.
    const samples = wav.pcm.length / (2 * wav.numChannels);
    const dur = samples / wav.sampleRate;
    console.log('[Voice] WAV 48kHz stereo detected. Streaming RAW PCM to Discord. Bytes:', wav.pcm.length, '| duration ~', dur.toFixed(2), 's');
    const vol = parseFloat(process.env.TTS_VOLUME || '1.6');
    const ffmpegArgs = [
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 'wav',
      '-i', 'pipe:0',
      '-ar', '48000',
      '-ac', '2',
      ...(isNaN(vol) ? [] : ['-filter:a', `volume=${Math.max(0.1, Math.min(vol, 5))}`]),
      '-f', 's16le',
      'pipe:1',
    ];
    const ffmpeg = new prism.FFmpeg({ args: ffmpegArgs, shell: false, ffmpegPath: ffmpegStatic || undefined });
    const input = bufferToStream(buffer);
    const pcm = input.pipe(ffmpeg);
    // Byte-level logging to verify audio data flow
    try {
      let outBytes = 0;
      pcm.on('data', (chunk) => { outBytes += chunk.length; });
      pcm.once('end', () => {
        debugLog('pcm-stream-ended', { bytes: outBytes });
      });
      // ffmpeg process diagnostics
      if (ffmpeg?.process) {
        try {
          ffmpeg.process.stderr?.setEncoding?.('utf8');
          ffmpeg.process.stderr?.on?.('data', (d) => {
            const s = (d || '').toString();
            if (s.trim()) debugLog('ffmpeg-stderr', { chunk: s.slice(0, 400) });
          });
          ffmpeg.process.on('close', (code, signal) => {
            debugLog('ffmpeg-close', { code, signal, bytes: outBytes });
          });
          ffmpeg.process.on('exit', (code, signal) => {
            debugLog('ffmpeg-exit', { code, signal, bytes: outBytes });
          });
          ffmpeg.process.on('error', (err) => {
            debugLog('ffmpeg-error', { message: err?.message || String(err) });
          });
        } catch {}
      }
      // Attach counter via metadata provider
      pcm.__byteCounter = () => outBytes;
    } catch {}
    debugLog('pcm-raw-stream', { ffmpegArgs });
    return createAudioResource(pcm, { inputType: StreamType.Raw, metadata: { kind: 'pcm-raw', bytes: () => pcm.__byteCounter?.() } });
  }

  // Otherwise, fall back to ffmpeg to decode/resample to s16le 48kHz stereo
  // Note: No volume filter to minimize processing as requested
  if (wav) {
    console.log('[Voice] WAV detected but needs resample/rechannel:', {
      audioFormat: wav.audioFormat,
      bitsPerSample: wav.bitsPerSample,
      sampleRate: wav.sampleRate,
      numChannels: wav.numChannels,
    });
    debugLog('wav-fallback', {
      audioFormat: wav.audioFormat,
      bitsPerSample: wav.bitsPerSample,
      sampleRate: wav.sampleRate,
      numChannels: wav.numChannels,
    });
  } else {
    console.log('[Voice] Non-WAV or unknown container; using ffmpeg decoder/resampler');
    debugLog('non-wav-fallback', {
      bufferLength: inBytes,
    });
  }
  let estSeconds = 0;
  if (wav && wav.bitsPerSample === 16) {
    const samples = wav.pcm.length / (2 * (wav.numChannels || 1));
    estSeconds = samples / (wav.sampleRate || 24000);
  } else {
    // rough guess for 24k mono
    estSeconds = inBytes > 0 ? (inBytes / (24000 * 1 * 2)) : 0;
  }
  console.log('[Voice] Decoding WAV to RAW PCM via ffmpeg. Input bytes:', inBytes, '| est duration ~', estSeconds.toFixed(2), 's');
  if (estSeconds && estSeconds < 0.6) console.warn('[Voice] Very short audio (<0.6s). It may be hard to notice.');
  const vol = parseFloat(process.env.TTS_VOLUME || '1.0');
  const ffmpegArgs = [
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 'wav',
    '-i', 'pipe:0',
    '-ar', '48000',
    '-ac', '2',
    ...(isNaN(vol) ? [] : ['-filter:a', `volume=${Math.max(0.1, Math.min(vol, 5))}`]),
    '-f', 's16le',
    'pipe:1',
  ];
  const ffmpeg = new prism.FFmpeg({ args: ffmpegArgs, shell: false, ffmpegPath: ffmpegStatic || undefined });
  const input = bufferToStream(buffer);
  const pcm = input.pipe(ffmpeg);
  // Byte-level logging to verify audio data flow
  try {
    let outBytes = 0;
    pcm.on('data', (chunk) => { outBytes += chunk.length; });
    pcm.once('end', () => {
      debugLog('pcm-stream-ended', { bytes: outBytes });
    });
    // ffmpeg process diagnostics
    if (ffmpeg?.process) {
      try {
        ffmpeg.process.stderr?.setEncoding?.('utf8');
        ffmpeg.process.stderr?.on?.('data', (d) => {
          const s = (d || '').toString();
          if (s.trim()) debugLog('ffmpeg-stderr', { chunk: s.slice(0, 400) });
        });
        ffmpeg.process.on('close', (code, signal) => {
          debugLog('ffmpeg-close', { code, signal, bytes: outBytes });
        });
        ffmpeg.process.on('exit', (code, signal) => {
          debugLog('ffmpeg-exit', { code, signal, bytes: outBytes });
        });
        ffmpeg.process.on('error', (err) => {
          debugLog('ffmpeg-error', { message: err?.message || String(err) });
        });
      } catch {}
    }
    // Attach counter via metadata provider
    pcm.__byteCounter = () => outBytes;
  } catch {}
  debugLog('ffmpeg-raw-pcm', { ffmpegArgs });
  return createAudioResource(pcm, { inputType: StreamType.Raw, metadata: { kind: 'pcm-raw', bytes: () => pcm.__byteCounter?.() } });
}

async function createAudioResourceFrom(buffer) {
  // If buffer is WAV, route through PCM conversion (ffmpeg or passthrough) for reliability
  const wav = parseWavPcm(buffer);
  if (wav) {
    console.log('[Voice] Detected WAV container; using PCM pipeline');
    return await createPcmResourceFrom(buffer);
  }

  // Non-WAV is not supported in this path as requested (no fallbacks).
  throw new Error('Audio buffer is not WAV/PCM. TTS must return WAV.');
}

async function playBufferInChannel(voiceChannel, buffer) {
  debugLog('playback-start', {
    channel: voiceChannel.name,
    bufferLength: buffer?.length,
    guild: voiceChannel.guild.name
  });
  console.log('[Voice] Preparing to play buffer in channel', {
    guildId: voiceChannel.guild.id,
    channelId: voiceChannel.id,
    bufferBytes: buffer?.length || 0,
  });
  const connection = await ensureConnection(voiceChannel);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  const resource = await createAudioResourceFrom(buffer);
  debugLog('resource-created', {
    resourceType: resource?.constructor?.name,
    volume: resource.volume?.volume,
    streamType: resource.playStream?.constructor?.name
  });
  connection.subscribe(player);

  return new Promise((resolve, reject) => {
    let resolved = false;
    const startedAt = Date.now();

    const cleanup = () => {
      // Do not destroy the connection here; keep it alive for persistent presence.
      try { player.stop(); } catch {}
    };

    player.once('error', (e) => {
      console.error('Audio player error:', e);
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(e);
      }
    });

    player.on('stateChange', (oldState, newState) => {
      console.log('[Voice] Player state:', oldState.status, '=>', newState.status);
      debugLog('player-state-change', {
        oldState: oldState.status,
        newState: newState.status,
      });
    });

    player.on(AudioPlayerStatus.Playing, () => {
      console.log('[Voice] Playback started');
      debugLog('playback-started', {});
    });

    player.on(AudioPlayerStatus.Idle, () => {
      const elapsedMs = Date.now() - startedAt;
      const playedMs = resource?.playbackDuration ?? null;
      let byteCount;
      try { byteCount = typeof resource?.metadata?.bytes === 'function' ? resource.metadata.bytes() : undefined; } catch {}
      console.log('[Voice] Playback ended (Idle)');
      debugLog('playback-ended', { elapsedMs, playbackDurationMs: playedMs, bytesStreamed: byteCount });
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    });

    // Safety timer to avoid hanging due to stalled streams; abort after 90s
    const safety = setTimeout(() => {
      if (!resolved) {
        const err = new Error('Playback timeout');
        console.error('Audio playback timeout');
        resolved = true;
        cleanup();
        reject(err);
      }
    }, 90_000);

    // Clear safety timer on resolve/reject
    const clearSafety = () => clearTimeout(safety);
    player.once('error', clearSafety);
    player.once(AudioPlayerStatus.Idle, clearSafety);

    const startPlayback = async () => {
      try {
        player.play(resource);
        console.log('[Voice] player.play() invoked');
        debugLog('player-play-invoked', {});
        // Wait up to 10s for the player to enter Playing; this helps surface issues early
        await entersState(player, AudioPlayerStatus.Playing, 10_000).catch(() => {});
      } catch (err) {
        console.error('[Voice] Error invoking player.play():', err);
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      }
    };

    try {
      void startPlayback();
    } catch (err) {
      console.error('[Voice] Error invoking player.play():', err);
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    }
  });
}

module.exports = {
  playBufferInChannel,
};
