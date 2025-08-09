const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with all bot commands'),

    async execute(interaction) {
        // Defer reply first since we're building an embed
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🌍 **Air Translator Bot - Command Guide**')
            .setDescription('**Transform your server into a multilingual community!**\n*Choose from the commands below to get started:*')
            .addFields(
                {
                    name: '🚀 **Quick Start**',
                    value: '**`/quicksetup`** - *Set up multiple channels instantly*\n' +
                        '┗ 💡 `/quicksetup channel1:#english language1:Spanish channel2:#french language2:English`\n\n' +
                        '**`/listsetups`** - *View all your translation setups*\n' +
                        '┗ 💡 `/listsetups`\n\n' +
                        '**`/deletesetup`** - *Remove a translation setup*\n' +
                        '┗ 💡 `/deletesetup name:General`',
                    inline: false
                },
                {
                    name: '⚙️ **Channel Management**',
                    value: '**`/addchannel`** - *Add a channel to existing setup*\n' +
                        '┗ 💡 `/addchannel setup:General channel:#german language:German`\n\n' +
                        '**`/removechannel`** - *Remove channel from setup*\n' +
                        '┗ 💡 `/removechannel setup:General channel:#german`\n\n' +
                        '**`/autocleanup`** - *Auto-delete original messages*\n' +
                        '┗ 💡 `/autocleanup enabled:true delay:30`\n' +
                        '┗ 📋 *Keeps your channels clean and organized*',
                    inline: false
                },
                {
                    name: '🌐 **Server Features**',
                    value: '**`/toggleservertranslation`** - *Global translation toggle*\n' +
                        '┗ 💡 `/toggleservertranslation enabled:true`\n' +
                        '┗ 📋 *Enable translation across all channels*\n\n' +
                        '**`/toggletone`** - *Smart tone understanding*\n' +
                        '┗ 💡 `/toggletone enabled:true`\n' +
                        '┗ 📋 *Preserves emotions and context in translations*\n\n' +
                        '**`/style`** - *Choose display style*\n' +
                        '┗ 💡 `/style type:thread` *(clean auto-archiving threads)*\n' +
                        '┗ 💡 `/style type:text channel:#general` *(direct messages)*\n' +
                        '┗ 📋 *Threads auto-archive after 30 seconds to keep channels tidy*',
                    inline: false
                },
                {
                    name: '📊 **Status & Rewards**',
                    value: '**`/votestatus`** - *Check usage & earn rewards*\n' +
                        '┗ 📈 View your server\'s translation statistics\n' +
                        '┗ 🎁 Get voting link for **10 bonus translations**\n' +
                        '┗ ⏰ Vote every 12 hours for automatic rewards!\n' +
                        '┗ 💡 `/votestatus`',
                    inline: false
                },
                {
                    name: '👤 **Personal Features**',
                    value: '**`/personalbuddy`** - *Your private translation assistant*\n' +
                        '┗ 📨 Get translations delivered to your DMs\n' +
                        '┗ 🔒 Works independently of server settings\n' +
                        '┗ 🏴 React with flags for instant translations\n' +
                        '┗ 💡 `/personalbuddy enabled:true languages:korean,spanish`\n\n' +
                        '**`/flags`** - *Learn about flag reactions*\n' +
                        '┗ 🏴 See all supported country flags\n' +
                        '┗ 📚 Quick reference guide for flag translations\n' +
                        '┗ 💡 `/flags`',
                    inline: false
                },
                {
                    name: '🏴 **Flag Translation Magic**',
                    value: '**✨ React with country flags to instantly translate ANY message!**\n\n' +
                        '**🎯 Popular Flags:**\n' +
                        '🇺🇸 English  •  🇪🇸 Spanish  •  🇫🇷 French  •  🇰🇷 Korean\n' +
                        '🇯🇵 Japanese  •  �� German  •  �� Chinese  •  �� Russian\n\n' +
                        '**⚡ Key Benefits:**\n' +
                        '┗ 🚀 **Instant** - No commands needed\n' +
                        '┗ 🌍 **60+ languages** supported\n' +
                        '┗ 📜 Works on **old and new** messages\n' +
                        '┗ ⏰ Auto-deletes after 30 seconds\n' +
                        '┗ 💡 **Pro Tip:** Use `/flags` to see all available languages',
                    inline: false
                },
                {
                    name: '🆘 **Need Help?**',
                    value: '**Having issues? We\'re here to help!**\n' +
                        '┗ 💬 Join our [Support Server](https://discord.gg/WeynxzR9nq)\n' +
                        '┗ 📖 Use `/help` anytime to see this guide\n' +
                        '┗ 🚀 Start with `/quicksetup` for fastest results!'
                }
            )
            .setFooter({ 
                text: '🌍 Air Translator Bot • Making Discord multilingual, one message at a time!'
            })
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [embed] 
        });
    }
};
