const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with all bot commands'),

    async execute(interaction) {
        // Defer reply first since we're building an embed
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const embed = new EmbedBuilder()
            .setColor('#1E90FF') // Dodger blue for better visibility
            .setTitle(' **Air Translator Bot - Command Guide** 🌟')
            .setDescription('```✨ Transform your server into a global community! ✨```\n**📚 Complete command reference below:**')
            .addFields(
                {
                    name: '🚀 **\n\n━━━ QUICK START ━━━**',
                    value: '```diff\n━━━ Get started in seconds! ━━━\n+ Multi-channel setup wizard\n+ View all configurations\n+ Remove unwanted setups\n```\n' +
                        '▫️ **`/quicksetup`** ➤ *Multi-channel setup wizard*\n' +
                        '   💡 Example: `/quicksetup channel1:#english language1:Spanish`\n\n' +
                        '▫️ **`/listsetups`** ➤ *View all configurations*\n' +
                        '   💡 Example: `/listsetups`\n\n' +
                        '▫️ **`/deletesetup`** ➤ *Remove unwanted setups*\n' +
                        '   💡 Example: `/deletesetup name:General`',
                    inline: false
                },
                {
                    name: '⚙️ **\n\n━━━ CHANNEL MANAGEMENT ━━━**',
                    value: '```yaml\n━━━ Advanced Channel Controls ━━━\n# Expand your translation network\n# Clean up unwanted channels  \n# Keep channels spotless\n```\n' +
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
                    name: '🌐 **\n\n━━━ POWER FEATURES ━━━**',
                    value: '```css\n━━━ Smart AI-Powered Translation ━━━\n/* Global translation mode */\n/* Emotion & context preservation */\n/* Choose your display style */\n```\n' +
                        '▫️ **`/globalmode`** ➤ *Global translation mode*\n' +
                        '   💡 Example: `/globalmode enabled:true`\n' +
                        '   🌍 *Works across ALL channels*\n\n' +
                        '▫️ **`/toggletone`** ➤ *Emotion & context preservation*\n' +
                        '   💡 Example: `/toggletone enabled:true`\n' +
                        '   🧠 *AI understands sarcasm, jokes & emotions*\n\n' +
                        '▫️ **`/style`** ➤ *Choose your display style*\n' +
                        '   💡 Example: `/style type:thread` *(organized threads)*\n' +
                        '   💡 Example: `/style type:text` *(direct messages)*\n' +
                        '   ⚡ *Threads auto-vanish in 1 minute!*',
                    inline: false
                },
                {
                    name: '🎁 **\n\n━━━ REWARDS & STATUS ━━━**',
                    value: '```fix\n━━━ Earn bonus translations daily! ━━━\n💎 Your translation dashboard\n🎁 Get 20 FREE bonus translations!\n⏰ Vote every 12 hours for rewards\n```\n' +
                        '▫️ **`/votestatus`** ➤ *Your translation dashboard*\n' +
                        '   📊 View server statistics & usage\n' +
                        '   🎁 **Get 25 FREE bonus translations!**\n' +
                        '   ⏰ Vote every 12 hours for rewards\n' +
                        '   💡 Example: `/votestatus`\n\n' +
                        '▫️ **`/premium`** ➤ *Premium status for this server*\n' +
                        '   📅 Shows premium join date and next renewal date\n' +
                        '   💡 Example: `/premium`',
                    inline: false
                },
                {
                    name: '👤 **\n\n━━━ PERSONAL TOOLS ━━━**',
                    value: '```ini\n━━━ Private Translation Assistant ━━━\n[personalbuddy] = Your private translator\n[flags] = Flag reaction guide\n```\n' +
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
                    name: '� **\n\n━━━ VOICE TRANSLATION ━━━**',
                    value: '```yaml\n━━━ Real-time voice-to-voice translation ━━━\n# AI-powered live voice translation\n# Bot joins your voice channel automatically\n```\n' +
                        '▫️ **`/call`** ➤ *Start voice translation in configured channel*\n' +
                        '   💡 Example: `/call`\n' +
                        '   🤖 *Bot joins your saved voice channel*\n\n' +
                        '▫️ **`/call action:stop`** ➤ *Stop voice translation*\n' +
                        '   💡 Example: `/call action:stop`\n' +
                        '   ⚙️ *Configure from Dashboard → Voice Call Translation tab*',
                    inline: false
                },
                {
                    name: '�🏴 **\n\n━━━ INSTANT FLAG MAGIC ━━━**',
                    value: '```glsl\n━━━ React with flags = Instant translation! ━━━\n✨ Popular country flags for quick access\n🌟 Works instantly on any message - old or new!\n```\n' +
                        '**🌟 Popular Flags:**\n' +
                        '🇺🇸 English  •  🇪🇸 Spanish  •  🇫🇷 French  •  🇰🇷 Korean\n' +
                        '🇯🇵 Japanese  •  🇩🇪 German  •  🇨🇳 Chinese  •  🇷🇺 Russian\n\n' +
                        '**💡 Pro Tips:**\n' +
                        '▫️ Use `/style` to switch between threads and text display\n' +
                        '▫️ Use `/flags` to see all 60+ supported languages\n' +
                        '▫️ Use `/toggletone` for emotion-aware translations\n' +
                        '▫️ Works instantly on any message - old or new!',
                    inline: false
                },
                {
                    name: '🆘 **\n\n━━━ NEED HELP? ━━━**',
                    value: '```diff\n━━━ We are here for you 24/7! ━━━\n+ Join Support Server for live help\n+ Use /help anytime for this guide\n+ Quick Start: Try /quicksetup first!\n+ Pro Commands: /style | /flags | /toggletone\n```\n' +
                        '🌐 **[Join Support Server](https://discord.gg/WeynxzR9nq)**\n' +
                        '📖 Use `/help` anytime for this guide\n' +
                        '🚀 **Quick Start:** Try `/quicksetup` first!\n' +
                        '💡 **Pro Commands:** `/style` | `/flags` | `/toggletone` for more options!\n\n' +
                        '```yaml\nMade with ❤️ for global communities\n```'
                }
            )
            .setFooter({ 
                text: '✨ Air Translator • Breaking language barriers • Use /help anytime!'
            })
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [embed] 
        });
    }
};
