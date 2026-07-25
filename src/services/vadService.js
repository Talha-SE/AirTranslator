/**
 * Voice Activity Detection (VAD) Service
 * 
 * Energy-based VAD with hysteresis for detecting speech vs noise.
 * Uses RMS energy analysis with adaptive thresholds to reliably
 * filter out non-speech audio before sending to Gemini.
 * 
 * No external ML dependencies — runs purely in JavaScript.
 */

// ==============================
// VAD Configuration
// ==============================

/** RMS energy threshold below which audio is considered silence/noise */
const VAD_SILENCE_THRESHOLD = 0.005;

/** RMS energy threshold above which audio is considered speech */
const VAD_SPEECH_THRESHOLD = 0.025;

/** Number of consecutive frames needed to confirm speech start */
const VAD_MIN_SPEECH_FRAMES = 2;

/** Number of consecutive silence frames needed to confirm speech end */
const VAD_MIN_SILENCE_FRAMES = 8;

/** Frame size in samples (512 samples = 32ms at 16kHz) */
const VAD_FRAME_SAMPLES = 512;

/** Max consecutive noise frames before force-ending */
const MAX_NOISE_FRAMES_BEFORE_END = 50;

// ==============================
// Per-User VAD Instance
// ==============================

/**
 * Create a VAD instance for a specific user.
 * Each user gets their own VAD to track independent speech state.
 * 
 * @param {string} userId - Discord user ID for logging
 * @param {string} username - Username for logging
 * @returns {Promise<Object>} - VAD wrapper object
 */
async function createUserVAD(userId, username) {
  let speechState = {
    isActive: false,
    speechProbability: 0,
    consecutiveNoiseFrames: 0,
    consecutiveSpeechFrames: 0,
    totalSpeechFrames: 0,
    totalNoiseFrames: 0,
    speechStartTime: null,
    lastSpeechTime: null,
    /** Accumulated samples for frame-based processing */
    sampleBuffer: new Float32Array(0),
  };

  /**
   * Calculate RMS energy of a Float32 audio frame.
   */
  function calculateRMS(frame) {
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < frame.length; i++) {
      const abs = Math.abs(frame[i]);
      if (abs > peak) peak = abs;
      sumSquares += frame[i] * frame[i];
    }
    const rms = Math.sqrt(sumSquares / frame.length);
    return { rms, peak };
  }

  /**
   * Process a single frame through the VAD.
   */
  function processFrame(frame) {
    const { rms, peak } = calculateRMS(frame);
    
    // Map RMS to a probability-like value (0-1) using sigmoid-like curve
    // This gives smoother transitions than a hard threshold
    const normalizedProb = Math.min(1, rms / 0.1); // normalize to 0-1 range
    speechState.speechProbability = normalizedProb;
    
    if (rms >= VAD_SPEECH_THRESHOLD) {
      // Speech detected
      speechState.consecutiveSpeechFrames++;
      speechState.consecutiveNoiseFrames = 0;
      speechState.totalSpeechFrames++;
    } else if (rms <= VAD_SILENCE_THRESHOLD) {
      // Silence/noise detected
      speechState.consecutiveNoiseFrames++;
      speechState.consecutiveSpeechFrames = 0;
      speechState.totalNoiseFrames++;
    } else {
      // In between thresholds — use hysteresis (keep previous state)
      if (speechState.isActive) {
        speechState.consecutiveNoiseFrames++;
        speechState.consecutiveSpeechFrames = 0;
        speechState.totalNoiseFrames++;
      } else {
        speechState.consecutiveSpeechFrames++;
        speechState.consecutiveNoiseFrames = 0;
        speechState.totalSpeechFrames++;
      }
    }
    
    // State transitions with hysteresis
    if (!speechState.isActive && speechState.consecutiveSpeechFrames >= VAD_MIN_SPEECH_FRAMES) {
      speechState.isActive = true;
      speechState.speechStartTime = Date.now();
      speechState.consecutiveNoiseFrames = 0;
    }
    
    if (speechState.isActive && speechState.consecutiveNoiseFrames >= VAD_MIN_SILENCE_FRAMES) {
      speechState.isActive = false;
      speechState.lastSpeechTime = Date.now();
      speechState.consecutiveNoiseFrames = 0;
    }
    
    return { rms, peak };
  }

  return {
    userId,
    username,
    state: speechState,
    
    /**
     * Process a PCM audio chunk and return speech detection result.
     * @param {Buffer} pcmBuffer - 16-bit PCM audio at 16kHz
     * @returns {Object} - { isSpeech, probability, consecutiveNoise }
     */
    processChunk(pcmBuffer) {
      // Convert 16-bit PCM to Float32 [-1, 1]
      const float32 = new Float32Array(pcmBuffer.length / 2);
      for (let i = 0; i < float32.length; i++) {
        float32[i] = pcmBuffer.readInt16LE(i * 2) / 32768;
      }
      
      // Append to sample buffer
      const newBuffer = new Float32Array(speechState.sampleBuffer.length + float32.length);
      newBuffer.set(speechState.sampleBuffer);
      newBuffer.set(float32, speechState.sampleBuffer.length);
      speechState.sampleBuffer = newBuffer;
      
      // Process complete frames
      let lastRMS = 0;
      let lastPeak = 0;
      let framesProcessed = 0;
      while (speechState.sampleBuffer.length >= VAD_FRAME_SAMPLES) {
        const frame = speechState.sampleBuffer.subarray(0, VAD_FRAME_SAMPLES);
        speechState.sampleBuffer = speechState.sampleBuffer.subarray(VAD_FRAME_SAMPLES);
        const { rms, peak } = processFrame(frame);
        lastRMS = rms;
        lastPeak = peak;
        framesProcessed++;
      }
      
      // Log EVERY chunk with raw PCM stats for debugging
      const maxSample = Math.max(...Array.from(float32).map(Math.abs));
      const avgAbs = Array.from(float32).reduce((s, v) => s + Math.abs(v), 0) / float32.length;
      console.log(`[VAD ${username}] chunk=${pcmBuffer.length}B frames=${framesProcessed} rms=${lastRMS.toFixed(6)} peak=${lastPeak.toFixed(6)} maxSample=${maxSample.toFixed(6)} avgAbs=${avgAbs.toFixed(6)} speech=${speechState.isActive} speechFrames=${speechState.totalSpeechFrames} noiseFrames=${speechState.totalNoiseFrames}`);
      
      return {
        isSpeech: speechState.isActive || speechState.speechProbability >= VAD_SPEECH_THRESHOLD,
        probability: speechState.speechProbability,
        consecutiveNoise: speechState.consecutiveNoiseFrames,
        consecutiveSpeech: speechState.consecutiveSpeechFrames,
        totalSpeechFrames: speechState.totalSpeechFrames,
        totalNoiseFrames: speechState.totalNoiseFrames,
        rms: lastRMS,
        /** Raw diagnostic info for debugging */
        debug: {
          samplesProcessed: float32.length,
          rms: lastRMS,
          speechThreshold: VAD_SPEECH_THRESHOLD,
          silenceThreshold: VAD_SILENCE_THRESHOLD,
          peakAmplitude: lastPeak,
          bufferLength: speechState.sampleBuffer.length,
        },
      };
    },
    
    /**
     * Check if we've been in noise for too long.
     */
    isNoiseTooLong() {
      return speechState.consecutiveNoiseFrames >= MAX_NOISE_FRAMES_BEFORE_END;
    },
    
    /**
     * Get speech ratio (speech frames / total frames).
     */
    getSpeechRatio() {
      const total = speechState.totalSpeechFrames + speechState.totalNoiseFrames;
      return total > 0 ? speechState.totalSpeechFrames / total : 0;
    },
    
    /**
     * Reset VAD state for new utterance.
     */
    reset() {
      speechState.isActive = false;
      speechState.speechProbability = 0;
      speechState.consecutiveNoiseFrames = 0;
      speechState.consecutiveSpeechFrames = 0;
      speechState.sampleBuffer = new Float32Array(0);
    },
    
    /**
     * Destroy VAD instance (no-op for energy-based VAD, kept for API compatibility).
     */
    async destroy() {
      speechState.sampleBuffer = new Float32Array(0);
    },
  };
}

module.exports = {
  createUserVAD,
  VAD_SPEECH_THRESHOLD,
  VAD_SILENCE_THRESHOLD,
  VAD_FRAME_SAMPLES,
  MAX_NOISE_FRAMES_BEFORE_END,
};
