# Stop the bot
pm2 stop air-translator

# Go to directory
cd ~/AirTranslator

# Pull latest code
git pull origin main

# If that fails, force reset
git fetch --all
git reset --hard origin/main

# Verify the new code is there (should show the environment check code)
grep "Environment Check" src/events/ready.js

# Delete pm2 from memory
pm2 delete air-translator

# Start fresh
pm2 start src/bot.js --name air-translator

# Watch logs - you should see "🔧 Environment Check:" 
pm2 logs air-translator




# Option 1: Update to newer prism-media that supports opusscript 0.1.x
npm install prism-media@latest --legacy-peer-deps

# Option 2: Downgrade opusscript to match prism-media
npm install opusscript@0.0.8 --legacy-peer-deps

# Then reinstall everything
npm install --legacy-peer-deps

# Restart
pm2 restart air-translator
pm2 logs air-translator --lines 50