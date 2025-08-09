const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { togglePersonalTranslation, getPersonalTranslationSettings } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('personalbuddy')
        .setDescription('Enable/disable personal translation buddy for your DMs')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable personal translation buddy')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('languages')
                .setDescription('Comma-separated list of languages to translate to (e.g., "korean,spanish,french")')
                .setRequired(false)),

    async execute(interaction) {
        const enabled = interaction.options.getBoolean('enabled');
        const languagesInput = interaction.options.getString('languages');
        const userId = interaction.user.id;

        try {
            // Parse languages if provided
            let targetLanguages = [];
            if (enabled && languagesInput) {
                targetLanguages = languagesInput.toLowerCase()
                    .split(',')
                    .map(lang => lang.trim())
                    .filter(lang => lang.length > 0);
            }

            // If enabling but no languages provided, use default
            if (enabled && targetLanguages.length === 0) {
                targetLanguages = ['korean', 'spanish', 'english'];
            }

            // Update personal translation settings
            const result = await togglePersonalTranslation(userId, enabled, targetLanguages);
            
            if (!result) {
                return interaction.reply({
                    content: '❌ There was an error updating your personal translation buddy settings.',
                    ephemeral: true
                });
            }

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor(enabled ? 0x00ff00 : 0xff0000)
                .setTitle(`🤖 Personal Translation Buddy ${enabled ? 'Enabled' : 'Disabled'}`)
                .setDescription(enabled ? 
                    `Your personal translation buddy is now **enabled**! 🎉\n\nReact with flag emojis on any message to get instant translations in your DMs.` :
                    `Your personal translation buddy has been **disabled**.`)
                .addFields(
                    {
                        name: '🌍 How It Works',
                        value: enabled ?
                            '• React with flag emojis (🇰🇷 🇪🇸 🇫🇷 🇩🇪 🇯🇵 etc.) on any message\n• Get instant translation sent to your DMs\n• Works independently of server settings\n• Available in all servers where the bot is present' :
                            'Personal translation buddy is now inactive.',
                        inline: false
                    }
                );

            if (enabled) {
                embed.addFields(
                    {
                        name: '🎯 Your Languages',
                        value: `**Target Languages:** ${targetLanguages.map(lang => 
                            lang.charAt(0).toUpperCase() + lang.slice(1)).join(', ')}`,
                        inline: false
                    },
                    {
                        name: '🚀 Getting Started',
                        value: '1. Find any message you want to translate\n2. React with a flag emoji (🇰🇷 for Korean, 🇪🇸 for Spanish, etc.)\n3. Check your DMs for the translation!\n\n*Tip: You can react to your own messages too!*',
                        inline: false
                    },
                    {
                        name: '⚙️ Settings',
                        value: '• **Privacy:** Only you receive the translations\n• **Independence:** Works regardless of server translation settings\n• **Flexibility:** Change languages anytime with `/personalbuddy`',
                        inline: false
                    }
                );
            }

            embed
                .setFooter({ 
                    text: `Personal Translation Buddy • User: ${interaction.user.username}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
            
        } catch (error) {
            console.error('Error in personal buddy command:', error);
            return interaction.reply({
                content: '❌ There was an error processing your personal translation buddy settings.',
                ephemeral: true
            });
        }
    }
};
