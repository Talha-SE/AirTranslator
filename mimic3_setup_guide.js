#!/usr/bin/env node

// Mimic3 Setup and Installation Guide
const fs = require('fs');
const path = require('path');

console.log('🎙️ Mimic3 TTS Setup Guide for Discord Translator Bot\n');
console.log('=' .repeat(60));

console.log('\n📋 Step-by-Step Installation Guide:');
console.log('=' .repeat(40));

console.log('\n1️⃣ PYTHON ENVIRONMENT SETUP:');
console.log('   Due to Python path conflicts with ZKBioTime, create a clean virtual environment:');
console.log('   ');
console.log('   # Clear conflicting environment variables');
console.log('   $env:PYTHONHOME = $null');
console.log('   $env:PATH = ($env:PATH -split \';\' | Where-Object { $_ -notlike \'*ZKBio*\' }) -join \';\'');
console.log('   ');
console.log('   # Create virtual environment');
console.log('   C:\\Python312\\python.exe -m venv mimic3_env');
console.log('   ');
console.log('   # Activate virtual environment');
console.log('   .\\mimic3_env\\Scripts\\Activate.ps1');

console.log('\n2️⃣ INSTALL MIMIC3:');
console.log('   Option A - Try full installation (may fail on Windows):');
console.log('   pip install mycroft-mimic3-tts[all]');
console.log('   ');
console.log('   Option B - If above fails, try core installation:');
console.log('   pip install mycroft-mimic3-tts');
console.log('   ');
console.log('   Option C - Use Docker (recommended for Windows):');
console.log('   docker run -p 59125:59125 mycroftai/mimic3');

console.log('\n3️⃣ START MIMIC3 SERVER:');
console.log('   # If installed with pip:');
console.log('   mimic3-server --port 59125');
console.log('   ');
console.log('   # The server will be available at: http://localhost:59125');

console.log('\n4️⃣ TEST THE SETUP:');
console.log('   # Run the test script:');
console.log('   node test_mimic3_tts.js');
console.log('   ');
console.log('   # Or test manually with curl:');
console.log('   curl -X POST "http://localhost:59125/api/tts" \\');
console.log('        -H "Content-Type: application/json" \\');
console.log('        -d \'{"text": "Hello world", "voice": "en_US/amy-medium"}\' \\');
console.log('        --output test.wav');

console.log('\n5️⃣ ENVIRONMENT VARIABLES:');
console.log('   Add these to your .env file:');
console.log('   ');
console.log('   MIMIC3_URL=http://localhost:59125');
console.log('   MIMIC3_DEFAULT_VOICE=en_US/amy-medium');
console.log('   TTS_VOLUME=1.6');

console.log('\n🐳 DOCKER SETUP (RECOMMENDED):');
console.log('=' .repeat(40));
console.log('If you prefer using Docker to avoid Python dependency issues:');
console.log('');
console.log('1. Install Docker Desktop');
console.log('2. Run: docker run -d -p 59125:59125 --name mimic3 mycroftai/mimic3');
console.log('3. The server will be available at: http://localhost:59125');
console.log('4. To stop: docker stop mimic3');
console.log('5. To start again: docker start mimic3');

console.log('\n🎤 AVAILABLE VOICES:');
console.log('=' .repeat(40));
console.log('Common English voices:');
console.log('- en_US/amy-medium (female, clear)');
console.log('- en_US/ljspeech-medium (female, natural)');
console.log('- en_US/mary_ann (female)'); 
console.log('- en_US/kathleen (female)');
console.log('- en_GB/alan-medium (male, British)');
console.log('');
console.log('To see all available voices, visit: http://localhost:59125/api/voices');

console.log('\n🔧 TROUBLESHOOTING:');
console.log('=' .repeat(40));
console.log('❌ Python conflicts with ZKBioTime:');
console.log('   Clear PYTHONHOME and remove ZKBio paths from PATH (see step 1)');
console.log('');
console.log('❌ "espeak-phonemizer" installation fails:');
console.log('   Use Docker instead, or install without [all] extras');
console.log('');
console.log('❌ Connection refused errors:');
console.log('   Make sure Mimic3 server is running on port 59125');
console.log('');
console.log('❌ Very slow TTS generation:');
console.log('   First request loads the model, subsequent requests are faster');

// Create a simple batch file for Windows users
const batchContent = `@echo off
echo Starting Mimic3 TTS Server...
echo.

REM Clear conflicting Python environment
set PYTHONHOME=
set PATH=%PATH:e:\\ZKBioTime\\Python311;=%
set PATH=%PATH:e:\\ZKBioTime\\Python311\\Scripts;=%
set PATH=%PATH:e:\\ZKBioTime\\Python311\\Library\\bin;=%
set PATH=%PATH:e:\\ZKBioTime\\Python311\\Lib\\site-packages;=%

REM Activate virtual environment if it exists
if exist mimic3_env\\Scripts\\activate.bat (
    call mimic3_env\\Scripts\\activate.bat
    echo Virtual environment activated.
) else (
    echo Virtual environment not found. Please create it first.
    echo Run: python -m venv mimic3_env
    pause
    exit /b 1
)

echo.
echo Starting Mimic3 server...
mimic3-server --port 59125

pause
`;

fs.writeFileSync(path.join(__dirname, 'start_mimic3.bat'), batchContent);
console.log('\n💾 Created start_mimic3.bat for easy server startup on Windows');

console.log('\n✅ Setup guide complete! Follow the steps above to get Mimic3 TTS working.');
console.log('🚀 Once the server is running, your Discord bot will have TTS capabilities!');