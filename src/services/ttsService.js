// Use dynamic import for ESM module compatibility in CommonJS
const crypto = require('crypto');
const { AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

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

// Default primary voice only; no implicit secondary
const DEFAULT_VOICES = {
  primary: 'Zephyr',
};

function buildGeminiConfig(voiceName1, voiceName2) {
  const primary = voiceName1 || DEFAULT_VOICES.primary;
  if (!voiceName2) {
    // Single-voice config
    return {
      temperature: 1,
      responseModalities: ['audio'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: primary } },
      },
    };
  }
  // Multi-speaker when explicitly requested
  return {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: 'Speaker 1',
            voiceConfig: { prebuiltVoiceConfig: { voiceName: primary } },
          },
          {
            speaker: 'Speaker 2',
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName2 } },
          },
        ],
      },
    },
  };
}

async function originalSynthesis(text, { voice1, voice2 } = {}) {
  console.log('[TTS-DEBUG] Starting synthesis for text:', text?.length > 50 ? text.slice(0,50)+'...' : text);
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
  if (!text || !text.trim()) throw new Error('No text provided for TTS');
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = 'gemini-2.5-flash-preview-tts';
  const config = buildGeminiConfig(voice1, voice2);
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text,
        },
      ],
    },
  ];

  if (voice2) {
    console.log('[TTS] Requesting Gemini audio with voices:', { voice1: voice1 || 'Zephyr', voice2 });
  } else {
    console.log('[TTS] Requesting Gemini audio with voice:', { voice: voice1 || 'Zephyr' });
  }
  const response = await ai.models.generateContentStream({ model, config, contents });

  // Collect audio chunks with logging
  const buffers = [];
  let chunkCount = 0;
  let lastMime = null;
  let lastFinish = null;
  let safetyLogged = false;
  for await (const chunk of response) {
    const part = chunk?.candidates?.[0]?.content?.parts?.[0];
    const cand = chunk?.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== lastFinish) {
      lastFinish = cand.finishReason;
      console.log('[TTS] Candidate finishReason:', lastFinish);
    }
    if (!safetyLogged && Array.isArray(cand?.safetyRatings)) {
      safetyLogged = true;
      console.log('[TTS] Safety ratings present, count:', cand.safetyRatings.length);
    }
    if (part?.inlineData) {
      const inlineData = part.inlineData;
      lastMime = inlineData.mimeType || lastMime;
      const ext = getExtFromMime(inlineData.mimeType || '');
      let buffer = Buffer.from(inlineData.data || '', 'base64');
      if (ext === 'wav') {
        // Might be already PCM WAV; if mime missing but raw PCM, convert
        if (!inlineData.mimeType || inlineData.mimeType.startsWith('audio/L')) {
          buffer = convertToWav(inlineData.data || '', inlineData.mimeType || 'audio/L16;rate=24000');
        }
      }
      buffers.push(buffer);
      chunkCount++;
    } else if (part?.text) {
      // Occasionally model may send textual parts; log for visibility
      console.log('[TTS] Received text part instead of audio:', part.text.slice(0, 80));
    }
  }

  const totalLen = buffers.reduce((n, b) => n + b.length, 0);
  console.log(`[TTS] Gemini audio chunks: ${chunkCount}, last mime: ${lastMime || 'unknown'}, total bytes: ${totalLen}`);

  if (buffers.length > 0) {
    console.log('[TTS-DEBUG] Generated audio buffer size:', buffers.reduce((n, b) => n + b.length, 0));
    const out = Buffer.concat(buffers);
    const preview = out.subarray(0, 16).toString('hex');
    const hash = crypto.createHash('sha1').update(out.subarray(0, 4096)).digest('hex');
    console.log('[TTS] Audio verification: first16B(hex)=', preview, '| sha1(first4KB)=', hash);
    return out;
  } else {
    console.error('[TTS-DEBUG] No audio generated!');
    return null;
  }

  // Fallback: try non-streaming generateContent once
  console.warn('[TTS] No audio from stream. Retrying once with non-streaming call...');
  try {
    const resp = await ai.models.generateContent({ model, config, contents });
    const cand = resp?.response?.candidates?.[0];
    const part = cand?.content?.parts?.[0];
    if (cand?.finishReason) console.log('[TTS] Fallback finishReason:', cand.finishReason);
    if (Array.isArray(cand?.safetyRatings)) console.log('[TTS] Fallback safety ratings count:', cand.safetyRatings.length);
    if (part?.inlineData) {
      const inlineData = part.inlineData;
      const ext = getExtFromMime(inlineData.mimeType || '');
      let buffer = Buffer.from(inlineData.data || '', 'base64');
      if (ext === 'wav') {
        if (!inlineData.mimeType || inlineData.mimeType.startsWith('audio/L')) {
          buffer = convertToWav(inlineData.data || '', inlineData.mimeType || 'audio/L16;rate=24000');
        }
      }
      const preview = buffer.subarray(0, 16).toString('hex');
      const hash = crypto.createHash('sha1').update(buffer.subarray(0, 4096)).digest('hex');
      console.log('[TTS] Fallback produced bytes:', buffer.length, 'mime:', inlineData.mimeType || 'unknown', '| first16B(hex)=', preview, '| sha1(first4KB)=', hash);
      return buffer.length > 0 ? buffer : null;
    }
  } catch (fallbackErr) {
    console.error('[TTS] Fallback non-streaming call failed:', fallbackErr?.message || fallbackErr);
  }

  return null;
}

async function synthesizeMultispeaker(text, { voice1, voice2 } = {}) {
  try {
    // Generate audio as before
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
