#!/usr/bin/env node

// Test script to verify Mimic3 TTS functionality
const { synthesizeMultispeaker } = require('./src/services/ttsService');
const fs = require('fs');
const path = require('path');

async function testMimic3TTS() {
    console.log('🎙️  Testing Mimic3 TTS Integration...\n');


    // Test cases
    const testCases = [
        {
            text: 'Hello, this is a test of the Mimic3 text-to-speech system.',
            voice1: 'en_US/amy-medium',
            description: 'Basic English test with Amy voice'
        },
        {
            text: 'Another test with a different voice configuration.',
            voice1: 'en_US/ljspeech-medium', 
            description: 'English test with LJSpeech voice'
        },
        {
            text: 'Testing with default voice settings.',
            voice1: undefined, // Should use default
            description: 'Test with default voice (fallback)'
        }
    ];

    let successCount = 0;
    let totalTests = testCases.length;

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        console.log(`\n📋 Test ${i + 1}/${totalTests}: ${testCase.description}`);
        console.log(`   Text: "${testCase.text}"`);
        console.log(`   Voice: ${testCase.voice1 || 'default'}`);

        try {
            const startTime = Date.now();
            const audioBuffer = await synthesizeMultispeaker(testCase.text, {
                voice1: testCase.voice1
            });
            const duration = Date.now() - startTime;

            if (audioBuffer && audioBuffer.length > 0) {
                console.log(`   ✅ SUCCESS - Generated ${audioBuffer.length} bytes in ${duration}ms`);
                
                // Save test audio file for manual verification
                const filename = `test_audio_${i + 1}.wav`;
                const filepath = path.join(__dirname, filename);
                fs.writeFileSync(filepath, audioBuffer);
                console.log(`   💾 Audio saved to: ${filename}`);
                
                successCount++;
            } else {
                console.log(`   ❌ FAILED - No audio data returned`);
            }
        } catch (error) {
            console.log(`   ❌ FAILED - Error: ${error.message}`);
            console.log(`   📄 Full error:`, error);
        }
    }

    // Summary
    console.log(`\n🏁 Test Summary:`);
    console.log(`   ✅ Successful: ${successCount}/${totalTests}`);
    console.log(`   ❌ Failed: ${totalTests - successCount}/${totalTests}`);

    if (successCount === totalTests) {
        console.log(`\n🎉 All tests passed! Mimic3 TTS is working correctly.`);
        console.log(`💡 Check the generated test_audio_*.wav files to verify audio quality.`);
    } else {
        console.log(`\n⚠️  Some tests failed. Check your Mimic3 server configuration.`);
        console.log(`📝 Make sure Mimic3 is running at: ${process.env.MIMIC3_URL || 'http://localhost:59125'}`);
    }

    // Environment check
    console.log(`\n🔧 Environment Configuration:`);
    console.log(`   MIMIC3_URL: ${process.env.MIMIC3_URL || 'http://localhost:59125 (default)'}`);
    console.log(`   MIMIC3_DEFAULT_VOICE: ${process.env.MIMIC3_DEFAULT_VOICE || 'en_US/amy-medium (default)'}`);
    console.log(`   MIMIC3_VOICE_EN: ${process.env.MIMIC3_VOICE_EN || 'not set'}`);
}

// Run the test
if (require.main === module) {
    testMimic3TTS().catch(error => {
        console.error('\n💥 Test script failed:', error);
        process.exit(1);
    });
}

module.exports = { testMimic3TTS };