// Use dynamic import for ESM module compatibility in CommonJS
const crypto = require('crypto');
const axios = require('axios');

// Lightweight helper to infer extension from mime type without ESM-only deps
function getExtFromMime(mimeType) {
  const mt = (mimeType || '').toLowerCase();
  if (!mt) return 'wav';
  if (mt.includes('wav')) return 'wav';
  if (mt.includes('mpeg') || mt.includes('mp3')) return 'mp3';
  if (mt.includes('ogg')) return 'ogg';
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('l16')) return 'wav';
  return 'wav';
}

// Minimal WAV helpers ported from the provided TS reference
function parseMimeType(mimeType) {
  const parts = (mimeType || '').split(';').map(s => s.trim());
  const fileType = parts[0] || 'audio/L16';
  const format = (fileType.split('/')[1] || '').trim();

  const options = { numChannels: 1 };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of parts.slice(1)) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      const sr = parseInt(value, 10);
      if (!isNaN(sr)) options.sampleRate = sr;
    }
  }

  // Sensible defaults if missing
  if (!options.sampleRate) options.sampleRate = 24000;
  if (!options.bitsPerSample) options.bitsPerSample = 16;

  return options;
}

function createWavHeader(dataLength, options) {
  const { numChannels, sampleRate, bitsPerSample } = options;
  const byteRate = Math.floor((sampleRate * numChannels * bitsPerSample) / 8);
  const blockAlign = Math.floor((numChannels * bitsPerSample) / 8);
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function convertToWav(rawBase64, mimeType) {
  const options = parseMimeType(mimeType);
  const rawBuffer = Buffer.from(rawBase64 || '', 'base64');
  const wavHeader = createWavHeader(rawBuffer.length, options);
  return Buffer.concat([wavHeader, rawBuffer]);
}

// Default voice for Mimic3; configurable via environment
const DEFAULT_VOICES = {
  // Prefer explicit env mappings; fall back to a common Mimic3 English voice
  primary: process.env.MIMIC3_DEFAULT_VOICE || process.env.MIMIC3_VOICE_EN || 'en_US/amy-medium',
};

function getMimicBaseUrl() {
  const base = process.env.MIMIC3_URL || 'http://localhost:59125';
  // strip trailing slash if provided
  return base.replace(/\/$/, '');
}

function pickMimicVoice(voiceName1) {
  const v = (voiceName1 || '').trim();
  // Heuristic: Mimic3 voices typically look like lang/voice-tier (e.g., en_US/amy-medium)
  // If legacy names like 'Zephyr' are passed, ignore and fallback to default
  if (v && v.includes('/')) return v;
  return DEFAULT_VOICES.primary;
}

async function originalSynthesis(text, { voice1, voice2 } = {}) {
  console.log('[TTS-DEBUG] Starting Mimic3 synthesis for text:', text?.length > 80 ? text.slice(0,80)+'...' : text);
  if (!text || !text.trim()) throw new Error('No text provided for TTS');

  const baseUrl = getMimicBaseUrl();
  const voice = pickMimicVoice(voice1);
  const url = `${baseUrl}/api/tts`;
  try {
    const resp = await axios.post(
      url,
      { text, voice },
      {
        responseType: 'arraybuffer',
        timeout: 60_000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/wav, audio/*;q=0.9, */*;q=0.8',
        },
      }
    );
    let contentType = resp.headers['content-type'] || 'application/octet-stream';
    let buffer = Buffer.from(resp.data);
    let preview = buffer.subarray(0, 16).toString('hex');
    let hash = crypto.createHash('sha1').update(buffer.subarray(0, 4096)).digest('hex');
    console.log('[TTS] Mimic3 POST returned bytes:', buffer.length, 'mime:', contentType, '| first16B(hex)=', preview, '| sha1(first4KB)=', hash);
    if (buffer.length > 0 && /audio\//i.test(contentType)) {
      return buffer;
    }

    // Fallback: try GET endpoint variant
    const getUrl = `${baseUrl}/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`;
    console.log('[TTS] Falling back to GET:', getUrl);
    const getResp = await axios.get(getUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      headers: {
        'Accept': 'audio/wav, audio/*;q=0.9, */*;q=0.8',
      },
    });
    contentType = getResp.headers['content-type'] || 'application/octet-stream';
    buffer = Buffer.from(getResp.data);
    preview = buffer.subarray(0, 16).toString('hex');
    hash = crypto.createHash('sha1').update(buffer.subarray(0, 4096)).digest('hex');
    console.log('[TTS] Mimic3 GET returned bytes:', buffer.length, 'mime:', contentType, '| first16B(hex)=', preview, '| sha1(first4KB)=', hash);
    return buffer.length > 0 ? buffer : null;
  } catch (err) {
    console.error('[TTS] Mimic3 synthesis failed:', err?.message || err);
    return null;
  }
}

async function synthesizeMultispeaker(text, { voice1, voice2 } = {}) {
  try {
    // For Mimic3 we synthesize using a single selected voice.
    const audioBuffer = await originalSynthesis(text, { voice1, voice2 });
    
    if (audioBuffer) {
      return audioBuffer;
    }
  } catch (err) {
    console.error('[TTS] Synthesis failed:', err);
  }
  return null;
}

// Helper function to convert WAV to MP3
async function convertToMp3(wavBuffer) {
  // Implement WAV to MP3 conversion logic here
  // For demonstration purposes, just return the original WAV buffer
  return wavBuffer;
}

module.exports = {
  synthesizeMultispeaker,
  convertToWav,
};
