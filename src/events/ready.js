const { ActivityType } = require('discord.js');
const VoiceCallTranslation = require('../models/VoiceCallTranslation');

module.exports = async (client) => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Log environment status for debugging production issues
    console.log('🔧 Environment Check:');
    console.log(`  - MISTRAL_API_KEY: ${process.env.MISTRAL_API_KEY ? '✅ Present' : '❌ MISSING'}`);
    console.log(`  - MISTRAL_DETECT_API_KEY: ${process.env.MISTRAL_DETECT_API_KEY ? '✅ Present' : '⚠️  Not set (will use main key)'}`);
    console.log(`  - MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Present' : '❌ MISSING'}`);
    console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    
    client.user.setActivity('Translating channels', { type: ActivityType.Watching });

    // Reset stale voice call translation sessions from previous run
    try {
        const staleSessions = await VoiceCallTranslation.updateMany(
            { isActive: true },
            { isActive: false }
        );
        if (staleSessions.modifiedCount > 0) {
            console.log(`🔄 Reset ${staleSessions.modifiedCount} stale voice call translation session(s)`);
        }
    } catch (err) {
        console.error(`❌ Error resetting stale sessions: ${err.message}`);
    }
};