#!/usr/bin/env node

// Environment setup helper for Mimic3 TTS
console.log('🔧 Mimic3 TTS Environment Setup Helper\n');

// Check current environment variables
const envVars = [
    { key: 'MIMIC3_URL', description: 'Mimic3 server URL', default: 'http://localhost:59125' },
    { key: 'MIMIC3_DEFAULT_VOICE', description: 'Default voice for TTS', default: 'en_US/amy-medium' },
    { key: 'MIMIC3_VOICE_EN', description: 'English voice override', default: 'en_US/amy-medium' },
    { key: 'MIMIC3_VOICE_ES', description: 'Spanish voice override', default: 'en_US/ljspeech-medium' },
    { key: 'MIMIC3_VOICE_FR', description: 'French voice override', default: 'en_US/ljspeech-medium' },
    { key: 'TTS_VOLUME', description: 'TTS playback volume (0.1-5.0)', default: '1.6' }
];

console.log('Current Environment Variables:');
console.log('='.repeat(50));

envVars.forEach(({ key, description, default: defaultValue }) => {
    const currentValue = process.env[key];
    const status = currentValue ? '✅' : '⚠️ ';
    const value = currentValue || `${defaultValue} (default)`;
    
    console.log(`${status} ${key}`);
    console.log(`   Description: ${description}`);
    console.log(`   Value: ${value}\n`);
});

// Provide setup instructions
console.log('📝 Setup Instructions:');
console.log('='.repeat(50));
console.log('1. Install and start Mimic3 server:');
console.log('   pip install mycroft-mimic3-tts[all]');
console.log('   mimic3-server --port 59125');
console.log('');
console.log('2. Set environment variables in your .env file:');
console.log('   MIMIC3_URL=http://localhost:59125');
console.log('   MIMIC3_DEFAULT_VOICE=en_US/amy-medium');
console.log('   TTS_VOLUME=1.6');
console.log('');
console.log('3. Available voices depend on your Mimic3 installation.');
console.log('   Common English voices: en_US/amy-medium, en_US/ljspeech-medium');
console.log('');
console.log('4. Test the setup by running:');
console.log('   node test_mimic3_tts.js');

// Check if Mimic3 server is accessible
const axios = require('axios');

async function checkMimic3Server() {
    const baseUrl = process.env.MIMIC3_URL || 'http://localhost:59125';
    
    console.log('\n🔍 Checking Mimic3 server connectivity...');
    
    try {
        const response = await axios.get(`${baseUrl}/api/voices`, { timeout: 5000 });
        console.log('✅ Mimic3 server is accessible!');
        console.log(`📋 Available voices: ${response.data.length} found`);
        
        if (response.data.length > 0) {
            console.log('\n🎤 Sample voices:');
            response.data.slice(0, 5).forEach(voice => {
                console.log(`   - ${voice.key || voice.name || voice}`);
            });
            if (response.data.length > 5) {
                console.log(`   ... and ${response.data.length - 5} more`);
            }
        }
    } catch (error) {
        console.log('❌ Cannot connect to Mimic3 server');
        console.log(`   URL: ${baseUrl}`);
        console.log(`   Error: ${error.message}`);
        console.log('\n💡 Make sure Mimic3 server is running:');
        console.log('   mimic3-server --port 59125');
    }
}

checkMimic3Server();