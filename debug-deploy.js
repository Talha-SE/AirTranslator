const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('Found command files:', commandFiles);
console.log('Commands path:', commandsPath);

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    console.log(`Loading: ${file} from ${filePath}`);
    try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            const commandData = command.data.toJSON();
            commands.push(commandData);
            console.log(`✅ Loaded command: ${commandData.name}`);
        } else {
            console.log(`❌ [WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            console.log('Has data:', 'data' in command, 'Has execute:', 'execute' in command);
        }
    } catch (error) {
        console.log(`💥 Error loading ${file}:`, error.message);
    }
}

console.log(`Total commands to deploy: ${commands.length}`);
console.log('Command names:', commands.map(c => c.name));

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
