const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPopularFlags, getSupportedFlags } = require('../utils/flagMapping');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('flags')
        .setDescription('Learn how to use flag reactions for instant translations'),
    
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const popularFlags = getPopularFlags();
            const totalFlags = getSupportedFlags().length;
            
            const embed = new EmbedBuilder()
                .setTitle('🏴 Flag Translation Feature')
                .setDescription('React to any message with a country flag to translate it to that language!')
                .setColor('#5865F2')
                .addFields(
                    {
                        name: '🚀 How to Use',
                        value: '1️⃣ Find **any message** you want to translate (new or old)\n2️⃣ React with a country flag emoji (🇺🇸, 🇪🇸, 🇫🇷, etc.)\n3️⃣ Get an instant translation reply!\n\n✨ **Works on any message in the server!**',
                        inline: false
                    },
                    {
                        name: '🔥 Popular Flags',
                        value: popularFlags.slice(0, 14).join(' ') + '\n*And many more!*',
                        inline: false
                    },
                    {
                        name: '📊 Stats',
                        value: `**${totalFlags} countries supported**\n**Instant translations**\n**No setup required**`,
                        inline: true
                    },
                    {
                        name: '💡 Smart Features',
                        value: '• Auto-detects source language\n• Skips if already in target language\n• Respects server translation limits\n• **Works on old and new messages**\n• Auto-deletes after 30 seconds',
                        inline: true
                    }
                )
                .addFields({
                    name: '🎯 Examples',
                    value: '• React 🇪🇸 to translate to Spanish\n• React 🇫🇷 to translate to French\n• React 🇯🇵 to translate to Japanese\n• React 🇩🇪 to translate to German\n\n**💡 Pro tip:** Works on messages from hours, days, or weeks ago!',
                    inline: false
                })
                .setFooter({
                    text: 'Try it now! React to this message or any old message with a flag emoji!',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            
            // Add some popular flag reactions to demonstrate
            const message = await interaction.fetchReply();
            const demoFlags = ['🇺🇸', '🇪🇸', '🇫🇷', '🇩🇪', '🇯🇵'];
            
            for (const flag of demoFlags) {
                try {
                    await message.react(flag);
                    // Small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.log(`Could not add reaction ${flag}`);
                }
            }
            
        } catch (error) {
            console.error('Error in flags command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('There was an error showing the flag translation guide. Please try again later.')
                .setColor('#e74c3c');
            
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};
