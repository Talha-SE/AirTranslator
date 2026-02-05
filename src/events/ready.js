const { ActivityType } = require('discord.js');

module.exports = (client) => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Log environment status for debugging production issues
    console.log('🔧 Environment Check:');
    console.log(`  - MISTRAL_API_KEY: ${process.env.MISTRAL_API_KEY ? '✅ Present' : '❌ MISSING'}`);
    console.log(`  - MISTRAL_DETECT_API_KEY: ${process.env.MISTRAL_DETECT_API_KEY ? '✅ Present' : '⚠️  Not set (will use main key)'}`);
    console.log(`  - MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Present' : '❌ MISSING'}`);
    console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    
    client.user.setActivity('Translating channels', { type: ActivityType.Watching });
};