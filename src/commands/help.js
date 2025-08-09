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
            .setTitle('🌍 Air Translator Bot Help')
            .setDescription('Here are all available commands with examples:')
            .addFields(
                {
                    name: '⚙️ Setup Commands',
                    value: '```' +
                        '/quicksetup - Quick setup with multiple channels/languages\n' +
                        '  Example: /quicksetup channel1:#english language1:Spanish channel2:#french language2:English\n\n' +
                        '/listsetups - List all translation setups\n' +
                        '  Example: /listsetups\n\n' +
                        '/deletesetup - Delete a translation setup\n' +
                        '  Example: /deletesetup name:General\n' +
                        '```'
                },
                {
                    name: '🔧 Channel Management',
                    value: '```' +
                        '/addchannel - Add channel to existing setup\n' +
                        '  Example: /addchannel setup:General channel:#german language:German\n\n' +
                        '/removechannel - Remove channel from setup\n' +
                        '  Example: /removechannel setup:General channel:#german\n\n' +
                        '/autocleanup - Auto-delete original messages after translation\n' +
                        '  Example: /autocleanup enabled:true delay:30\n' +
                        '  Example: /autocleanup enabled:true channel:#english delay:15\n' +
                        '```'
                },
                {
                    name: '🌐 Server-Wide Features',
                    value: '```' +
                        '/toggleservertranslation - Enable/disable translation across all channels\n' +
                        '  Example: /toggleservertranslation enabled:true\n\n' +
                        '/toggletone - Toggle tone understanding feature\n' +
                        '  Example: /toggletone enabled:true\n' +
                        '```'
                },
                {
                    name: '📊 Status & Voting',
                    value: '```' +
                        '/votestatus - Check vote status and earn bonus translations\n' +
                        '  • Shows your server\'s translation usage\n' +
                        '  • Provides voting link for 10 bonus translations\n' +
                        '  • Vote every 12 hours for automatic rewards!\n' +
                        '  Example: /votestatus\n\n' +
                        '/flags - Learn about flag reaction translations\n' +
                        '  Example: /flags\n' +
                        '```'
                },
                {
                    name: '👤 Personal Translation',
                    value: '```' +
                        '/personalbuddy - Enable personal translation buddy for DMs\n' +
                        '  • Get translations sent directly to your DMs\n' +
                        '  • Independent of server settings\n' +
                        '  • React with flags to get instant translations\n' +
                        '  Example: /personalbuddy enabled:true languages:korean,spanish\n' +
                        '```'
                },
                {
                    name: '🏴 Flag Translation Feature',
                    value: '**React with country flags** to instantly translate **any message**!\n• React 🇺🇸 for English\n• React 🇪🇸 for Spanish\n• React 🇫🇷 for French\n• Works on old and new messages!\n• And 60+ more languages!',
                    inline: false
                },
                {
                    name: '❓ Need More Help?',
                    value: 'Join our [support server](https://discord.gg/WeynxzR9nq) for support.'
                }
            )
            .setFooter({ text: 'Air Translator Bot • /help' });

        await interaction.editReply({ 
            embeds: [embed] 
        });
    }
};
