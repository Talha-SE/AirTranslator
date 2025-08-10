const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.                {
                    name: '🏴 **━━━ INSTANT FLAG MAGIC ━━━**',
                    value: '```glsl\n✨ React with flags = Instant translation! ✨\n```' +
                        '**🌟 Popular Flags:**\n' +
                        '🇺🇸 English  •  🇪🇸 Spanish  •  🇫🇷 French  •  🇰🇷 Korean\n' +
                        '🇯🇵 Japanese  •  🇩🇪 German  •  🇨🇳 Chinese  •  🇷🇺 Russian\n\n' +
                        '**⚙️ Related Commands:**\n' +
                        '▫️ **`/flags`** ➤ *View all supported country flags*\n' +
                        '▫️ **`/toggletone`** ➤ *Enable smart tone understanding*\n' +
                        '▫️ **`/style`** ➤ *Choose thread or text display style*',ule.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with all bot commands'),

    async execute(interaction) {
        // Defer reply first since we're building an embed
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const embed = new EmbedBuilder()
            .setColor('#1E90FF') // Dodger blue for better visibility
            .setTitle('� **Air Translator Bot - Command Guide** 🌟')
            .setDescription('```✨ Transform your server into a global community! ✨```\n**📚 Complete command reference below:**')
            .addFields(
                {
                    name: '🚀 **━━━ QUICK START ━━━**',
                    value: '```diff\n+ Get started in seconds!\n```' +
                        '▫️ **`/quicksetup`** ➤ *Multi-channel setup wizard*\n' +
                        '   💡 Example: `/quicksetup channel1:#english language1:Spanish`\n\n' +
                        '▫️ **`/listsetups`** ➤ *View all configurations*\n' +
                        '   💡 Example: `/listsetups`\n\n' +
                        '▫️ **`/deletesetup`** ➤ *Remove unwanted setups*\n' +
                        '   💡 Example: `/deletesetup name:General`',
                    inline: false
                },
                {
                    name: '⚙️ **━━━ CHANNEL MANAGEMENT ━━━**',
                    value: '```yaml\n# Advanced Channel Controls\n```' +
                        '▫️ **`/addchannel`** ➤ *Expand your translation network*\n' +
                        '   💡 Example: `/addchannel setup:General channel:#german language:German`\n\n' +
                        '▫️ **`/removechannel`** ➤ *Clean up unwanted channels*\n' +
                        '   💡 Example: `/removechannel setup:General channel:#german`\n\n' +
                        '▫️ **`/autocleanup`** ➤ *Keep channels spotless*\n' +
                        '   💡 Example: `/autocleanup enabled:true delay:30`\n' +
                        '   🧹 *Automatically removes original messages*',
                    inline: false
                },
                {
                    name: '🌐 **━━━ POWER FEATURES ━━━**',
                    value: '```css\n/* Smart AI-Powered Translation */\n```' +
                        '▫️ **`/toggleservertranslation`** ➤ *Global translation mode*\n' +
                        '   💡 Example: `/toggleservertranslation enabled:true`\n' +
                        '   🌍 *Works across ALL channels*\n\n' +
                        '▫️ **`/toggletone`** ➤ *Emotion & context preservation*\n' +
                        '   💡 Example: `/toggletone enabled:true`\n' +
                        '   🧠 *AI understands sarcasm, jokes & emotions*\n\n' +
                        '▫️ **`/style`** ➤ *Choose your display style*\n' +
                        '   💡 Example: `/style type:thread` *(organized threads)*\n' +
                        '   💡 Example: `/style type:text` *(direct messages)*\n' +
                        '   ⚡ *Threads auto-vanish in 30 seconds!*',
                    inline: false
                },
                {
                    name: '🎁 **━━━ REWARDS & STATUS ━━━**',
                    value: '```fix\n💎 Earn bonus translations daily!\n```' +
                        '▫️ **`/votestatus`** ➤ *Your translation dashboard*\n' +
                        '   � View server statistics & usage\n' +
                        '   🎁 **Get 10 FREE bonus translations!**\n' +
                        '   ⏰ Vote every 12 hours for rewards\n' +
                        '   💡 Example: `/votestatus`',
                    inline: false
                },
                {
                    name: '👤 **━━━ PERSONAL TOOLS ━━━**',
                    value: '```ini\n[Private Translation Assistant]\n```' +
                        '▫️ **`/personalbuddy`** ➤ *Your private translator*\n' +
                        '   📨 Translations delivered to your DMs\n' +
                        '   🔒 Independent from server settings\n' +
                        '   💡 Example: `/personalbuddy enabled:true languages:korean,spanish`\n\n' +
                        '▫️ **`/flags`** ➤ *Flag reaction guide*\n' +
                        '   🏴 Complete country flag reference\n' +
                        '   📚 Quick translation tutorial\n' +
                        '   💡 Example: `/flags`',
                    inline: false
                },
                {
                    name: '🏴 **━━━ INSTANT FLAG MAGIC ━━━**',
                    value: '```glsl\n✨ React with flags = Instant translation! ✨\n```' +
                        '**� Popular Flags:**\n' +
                        '🇺🇸 English  •  🇪🇸 Spanish  •  🇫🇷 French  •  🇰🇷 Korean\n' +
                        '🇯🇵 Japanese  •  🇩🇪 German  •  🇨🇳 Chinese  •  🇷🇺 Russian\n\n' +
                        '**⚡ Super Powers:**\n' +
                        '▫️ 🚀 **Zero setup** - Works instantly!\n' +
                        '▫️ 🌍 **60+ languages** at your fingertips\n' +
                        '▫️ 📜 **Time travel** - Works on old messages too\n' +
                        '▫️ ⏰ **Self-cleaning** - Auto-deletes in 30s\n' +
                        '💡 **Pro Tip:** Use `/flags` for the complete list!',
                    inline: false
                },
                {
                    name: '🆘 **━━━ NEED HELP? ━━━**',
                    value: '```diff\n+ We are here for you 24/7!\n```' +
                        '� **[Join Support Server](https://discord.gg/WeynxzR9nq)**\n' +
                        '📖 Use `/help` anytime for this guide\n' +
                        '🚀 **Quick Start:** Try `/quicksetup` first!\n' +
                        '💡 **Pro Tip:** Start small, then expand!\n\n' +
                        '```yaml\nMade with ❤️ for global communities\n```'
                }
            )
            .setFooter({ 
                text: '� Air Translator • Breaking language barriers • Use /help anytime!'
            })
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [embed] 
        });
    }
};
