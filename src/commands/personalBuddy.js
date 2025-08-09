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
                    flags: ['Ephemeral']
                });
            }

            // Create response embed with improved design
            const embed = new EmbedBuilder()
                .setColor(enabled ? '#10b981' : '#ef4444')
                .setTitle(`${enabled ? '✅' : '❌'} Personal Translation Buddy ${enabled ? 'Activated' : 'Deactivated'}`)
                .setDescription(enabled ? 
                    `🎉 **Your personal translator is now active!**\n\n> React with any flag emoji on messages to get instant translations delivered to your DMs.` :
                    `> Your personal translation buddy has been deactivated.`)
                .addFields(
                    {
                        name: `${enabled ? '🚀' : '💭'} How It Works`,
                        value: enabled ?
                            '**🔹 React** with flag emojis (🇰🇷 🇪🇸 🇫🇷 🇩🇪 🇯🇵 etc.) on any message\n**🔹 Receive** instant translation sent privately to your DMs\n**🔹 Independent** of server settings - works everywhere\n**🔹 Private** - only you see your translations' :
                            '> Personal translation feature is now inactive. Use `/personalbuddy enabled:true` to reactivate.',
                        inline: false
                    }
                );

            if (enabled) {
                embed.addFields(
                    {
                        name: '🎯 Your Translation Languages',
                        value: `> **${targetLanguages.map(lang => 
                            `${lang.charAt(0).toUpperCase() + lang.slice(1)}`).join(' • ')}**`,
                        inline: false
                    },
                    {
                        name: '� Quick Start Guide',
                        value: '```\n1️⃣ Find any message you want to translate\n2️⃣ React with a flag emoji (🇰🇷 🇪🇸 🇫🇷 etc.)\n3️⃣ Check your DMs for instant translation!\n4️⃣ Works on old and new messages\n```',
                        inline: false
                    },
                    {
                        name: '⚡ Features',
                        value: '**🔒 Private** - Only you receive translations\n**🌐 Global** - Works in all servers with the bot\n**🎨 Smart** - Enhanced tone understanding\n**⚙️ Flexible** - Change languages anytime',
                        inline: false
                    }
                );
            }

            embed
                .setFooter({ 
                    text: `Personal Translation Buddy • ${interaction.user.username}`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            return interaction.reply({ 
                embeds: [embed], 
                flags: ['Ephemeral'] 
            });
            
        } catch (error) {
            console.error('Error in personal buddy command:', error);
            return interaction.reply({
                content: '❌ There was an error processing your personal translation buddy settings.',
                flags: ['Ephemeral']
            });
        }
    }
};
