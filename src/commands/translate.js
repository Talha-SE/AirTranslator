const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { translateText, detectLanguage } = require('../services/mistralService');

function getLanguageDisplayName(language) {
    if (!language) return 'Unknown';
    // Simple capitalization
    return language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('translate')
        .setDescription('Translate text manually (Use this if auto-translation is disabled)')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to translate')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('target_language')
                .setDescription('Target language (e.g. Spanish, French, ja, es)')
                .setRequired(true)),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        const text = interaction.options.getString('text');
        const targetLanguage = interaction.options.getString('target_language');
        
        try {
            const detected = await detectLanguage(text);
            const translation = await translateText(text, targetLanguage, detected);
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Translation')
                .addFields(
                    { name: `Original (${getLanguageDisplayName(detected)})`, value: text.substring(0, 1024) },
                    { name: `Translation (${getLanguageDisplayName(targetLanguage)})`, value: translation.substring(0, 1024) }
                )
                .setFooter({ text: 'Executed via Slash Command' });
                
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply('Failed to translate. Please check the language code/name.');
        }
    },
};
