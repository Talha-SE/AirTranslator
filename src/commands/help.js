const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with all bot commands'),

    async execute(interaction) {
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
                        '  Example: /removechannel setup:General channel:#german\n' +
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
                    name: '❓ Need More Help?',
                    value: 'Join our [support server](https://discord.gg/WeynxzR9nq) for support.'
                }
            )
            .setFooter({ text: 'Air Translator Bot • /help' });

        return interaction.reply({ 
            embeds: [embed], 
            flags: MessageFlags.Ephemeral 
        });
    }
};
