const { createAudioPlayer, createAudioResource, joinVoiceChannel, NoSubscriberBehavior, VoiceConnectionStatus, entersState, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { Readable } = require('stream');
const OpusScript = require('opusscript');

// Simple WAV parser for PCM format
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

// Simple PCM resampling
function resampleToStereo48k(inputPcm, fromRate, fromChannels) {
  if (fromRate === 48000 && fromChannels === 2) {
    return inputPcm;
  }
  
  const inputSamples = inputPcm.length / (2 * fromChannels);
  const outputSamples = Math.floor(inputSamples * 48000 / fromRate);
  const output = Buffer.alloc(outputSamples * 4); // stereo 16-bit
  
  for (let i = 0; i < outputSamples; i++) {
    const srcSampleIndex = Math.floor(i * fromRate / 48000);
    const srcByteIndex = srcSampleIndex * fromChannels * 2;
    
    let leftSample = 0;
    let rightSample = 0;
    
    if (srcByteIndex < inputPcm.length) {
      leftSample = inputPcm.readInt16LE(srcByteIndex);
      if (fromChannels === 2 && srcByteIndex + 2 < inputPcm.length) {
        rightSample = inputPcm.readInt16LE(srcByteIndex + 2);
      } else {
        rightSample = leftSample; // Mono to stereo
      }
    }
    
    output.writeInt16LE(leftSample, i * 4);
    output.writeInt16LE(rightSample, i * 4 + 2);
  }
  
  return output;
}

// Apply volume to stereo PCM
function applyVolume(pcmData, volume) {
  if (volume === 1.0) return pcmData;
  
  const output = Buffer.alloc(pcmData.length);
  for (let i = 0; i < pcmData.length; i += 2) {
    const sample = pcmData.readInt16LE(i);
    const amplified = Math.max(-32768, Math.min(32767, Math.floor(sample * volume)));
    output.writeInt16LE(amplified, i);
  }
  return output;
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

  try {
    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      console.log('[Voice] Waiting for connection...');
      await entersState(connection, VoiceConnectionStatus.Connecting, 10_000);
      await entersState(connection, VoiceConnectionStatus.Ready, 25_000);
      console.log('[Voice] Connection ready');
    }
  } catch (err) {
    console.error('[Voice] Connection failed:', err);
    try { connection.destroy(); } catch {}
    throw err;
  }

  return connection;
}

function createAudioResourceFromWav(buffer) {
  const wav = parseWavPcm(buffer);
  if (!wav || wav.audioFormat !== 1) {
    throw new Error('Only PCM WAV files are supported');
  }

  console.log('[Voice] Processing WAV:', {
    sampleRate: wav.sampleRate,
    channels: wav.numChannels,
    bits: wav.bitsPerSample,
    dataBytes: wav.pcm.length,
    estimatedDurationSecs: (wav.pcm.length / (wav.sampleRate * wav.numChannels * 2)).toFixed(2)
  });

  // Convert to 48kHz stereo
  let pcmData = resampleToStereo48k(wav.pcm, wav.sampleRate, wav.numChannels);
  
  // Apply volume
  const volume = parseFloat(process.env.TTS_VOLUME || '1.6');
  pcmData = applyVolume(pcmData, volume);

  console.log('[Voice] Encoding with OpusScript...');
  
  // Create Opus encoder
  const encoder = new OpusScript(48000, 2);
  const frameSize = 960; // 20ms frames at 48kHz
  const frameSizeBytes = frameSize * 4; // stereo 16-bit
  
  // Encode all frames
  const opusPackets = [];
  for (let offset = 0; offset < pcmData.length; offset += frameSizeBytes) {
    const frame = pcmData.subarray(offset, offset + frameSizeBytes);
    if (frame.length === frameSizeBytes) {
      const packet = encoder.encode(frame, frameSize);
      if (packet && packet.length > 0) {
        opusPackets.push(packet);
      }
    }
  }
  
  console.log('[Voice] Encoded', opusPackets.length, 'Opus packets');
  
  if (opusPackets.length === 0) {
    throw new Error('No Opus packets generated');
  }

  // Create stream that feeds Opus packets
  let packetIndex = 0;
  const opusStream = new Readable({
    read() {
      if (packetIndex < opusPackets.length) {
        this.push(opusPackets[packetIndex++]);
      } else {
        this.push(null); // End stream
      }
    }
  });

  const resource = createAudioResource(opusStream, {
    inputType: StreamType.Opus,
    inlineVolume: false
  });

  return resource;
}

async function playBufferInChannel(voiceChannel, buffer) {
  console.log('[Voice] Starting playback in', voiceChannel.name);
  
  const connection = await ensureConnection(voiceChannel);
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  const resource = createAudioResourceFromWav(buffer);
  connection.subscribe(player);

  return new Promise((resolve, reject) => {
    let resolved = false;

    const cleanup = () => {
      try { player.stop(); } catch {}
    };

    player.once('error', (e) => {
      console.error('[Voice] Player error:', e);
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(e);
      }
    });

    player.on('stateChange', (oldState, newState) => {
      console.log('[Voice] Player:', oldState.status, '=>', newState.status);
    });

    player.on(AudioPlayerStatus.Playing, () => {
      console.log('[Voice] Playback started');
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log('[Voice] Playback finished');
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    });

    // 60s timeout
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.error('[Voice] Playback timeout');
        resolved = true;
        cleanup();
        reject(new Error('Playback timeout'));
      }
    }, 60_000);

    player.once('error', () => clearTimeout(timeout));
    player.once(AudioPlayerStatus.Idle, () => clearTimeout(timeout));

    try {
      player.play(resource);
      console.log('[Voice] Play command sent');
    } catch (err) {
      console.error('[Voice] Play failed:', err);
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