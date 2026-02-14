const { connectDB, getAllServers } = require('./src/services/databaseService');
const mongoose = require('mongoose');
const Server = require('./src/models/Server'); // Load model directly to be sure

async function checkIds() {
    try {
        console.log('Connecting to database...');
        await connectDB();
        
        console.log('Searching specifically for setups...');
        // Find ANY server that has at least one setup
        const serversWithSetups = await Server.find({ "setups.0": { $exists: true } });
        console.log(`Servers with at least one setup: ${serversWithSetups.length}`);

        if (serversWithSetups.length > 0) {
            serversWithSetups.forEach(s => {
                console.log(`Server: ${s.serverName} (${s.serverId}) has ${s.setups.length} setups.`);
                s.setups.forEach(setup => {
                    console.log(` - Setup: "${setup.name}", ID: ${setup.setupId}`);
                    if (!setup.setupId) {
                        console.log('   ^^^^^^^^ WARNING: MISSING ID');
                    }
                });
            });
        } else {
            console.log("No servers with setups found via direct query.");
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkIds();