#!/usr/bin/env python3
"""
Simple TTS Server that mimics the Mimic3 API
This is a lightweight alternative for testing TTS functionality
when Mimic3 is not available or difficult to install.
"""

import json
import logging
import os
import sys
from io import BytesIO
from pathlib import Path

try:
    import numpy as np
    import torch
    import torchaudio
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import uvicorn
except ImportError as e:
    print(f"Missing required dependencies: {e}")
    print("Please run: pip install torch torchaudio fastapi uvicorn numpy")
    sys.exit(1)

# Configuration
HOST = "127.0.0.1"
PORT = 59125
LOG_LEVEL = "INFO"

# Initialize FastAPI app
app = FastAPI(title="Simple TTS Server", version="1.0.0")

# Request/Response models
class TTSRequest(BaseModel):
    text: str
    voice: str = "en_US/amy-medium"

class VoiceInfo(BaseModel):
    key: str
    name: str
    language: str

# Available voices (mock data)
AVAILABLE_VOICES = [
    {"key": "en_US/amy-medium", "name": "Amy (Medium)", "language": "en-US"},
    {"key": "en_US/ljspeech-medium", "name": "LJ Speech (Medium)", "language": "en-US"},
    {"key": "en_US/mary_ann", "name": "Mary Ann", "language": "en-US"},
    {"key": "en_US/kathleen", "name": "Kathleen", "language": "en-US"},
    {"key": "en_GB/alan-medium", "name": "Alan (Medium)", "language": "en-GB"},
]

def generate_sine_wave_audio(text: str, voice: str) -> bytes:
    """
    Generate a simple sine wave audio as placeholder TTS.
    In a real implementation, this would use a TTS model.
    """
    # Basic parameters
    sample_rate = 22050
    duration = max(0.5, len(text) * 0.05)  # Rough estimate based on text length
    
    # Generate sine wave with varying frequency based on text
    t = torch.linspace(0, duration, int(sample_rate * duration))
    base_freq = 220  # A3 note
    
    # Simple variation based on voice name
    if "amy" in voice.lower():
        base_freq = 260  # C4 - higher pitch
    elif "alan" in voice.lower():
        base_freq = 196  # G3 - lower pitch
    elif "ljspeech" in voice.lower():
        base_freq = 233  # Bb3 - medium pitch
    
    # Create a simple melody that varies with text content
    frequencies = []
    for i, char in enumerate(text.lower()):
        if char.isalpha():
            # Map letters to frequency variations
            freq_offset = (ord(char) - ord('a')) * 5
            frequencies.append(base_freq + freq_offset)
        else:
            frequencies.append(base_freq)
    
    # Generate audio segments
    audio_segments = []
    chars_per_second = max(1, len(text) / duration)
    samples_per_char = int(sample_rate / chars_per_second)
    
    for i, freq in enumerate(frequencies):
        start_sample = i * samples_per_char
        end_sample = min((i + 1) * samples_per_char, len(t))
        if start_sample < len(t):
            segment_t = t[start_sample:end_sample]
            if len(segment_t) > 0:
                segment_audio = 0.3 * torch.sin(2 * torch.pi * freq * segment_t)
                audio_segments.append(segment_audio)
    
    # Combine segments
    if audio_segments:
        audio = torch.cat(audio_segments)
    else:
        # Fallback
        audio = 0.3 * torch.sin(2 * torch.pi * base_freq * t)
    
    # Add some envelope to make it sound more natural
    envelope = torch.exp(-t * 2)  # Exponential decay
    audio = audio * envelope
    
    # Convert to int16 PCM
    audio_int16 = (audio * 32767).int()
    
    # Create WAV file in memory
    buffer = BytesIO()
    torchaudio.save(buffer, audio_int16.unsqueeze(0), sample_rate, format="wav")
    buffer.seek(0)
    
    return buffer.getvalue()

@app.get("/")
async def root():
    return {"message": "Simple TTS Server", "status": "running", "api_version": "1.0"}

@app.get("/api/voices")
async def get_voices():
    """Return list of available voices"""
    return AVAILABLE_VOICES

@app.post("/api/tts")
async def synthesize_speech(request: TTSRequest):
    """
    Synthesize speech from text
    """
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        # Log the request
        print(f"TTS Request: '{request.text[:50]}...' with voice '{request.voice}'")
        
        # Generate audio (placeholder implementation)
        audio_data = generate_sine_wave_audio(request.text, request.voice)
        
        # Return WAV audio
        from fastapi import Response
        return Response(
            content=audio_data,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=tts.wav",
                "Content-Length": str(len(audio_data))
            }
        )
        
    except Exception as e:
        logging.error(f"TTS synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")

@app.get("/api/tts")
async def synthesize_speech_get(text: str, voice: str = "en_US/amy-medium"):
    """
    GET endpoint for TTS (alternative to POST)
    """
    request = TTSRequest(text=text, voice=voice)
    return await synthesize_speech(request)

if __name__ == "__main__":
    print(f"🎙️  Starting Simple TTS Server...")
    print(f"📡 Server: http://{HOST}:{PORT}")
    print(f"🎤 Voices: {len(AVAILABLE_VOICES)} available")
    print(f"📋 API Docs: http://{HOST}:{PORT}/docs")
    print(f"")
    print(f"⚠️  Note: This is a mock TTS server for testing purposes.")
    print(f"   It generates simple audio tones instead of actual speech.")
    print(f"   For real TTS, install and use Mimic3 or another TTS engine.")
    print(f"")
    
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level=LOG_LEVEL.lower()
    )