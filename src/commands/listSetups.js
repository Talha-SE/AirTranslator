const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getServerSetups } = require('../services/databaseService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listsetups')
        .setDescription('List all translation setups for this server.'),

    async execute(interaction) {
        const serverId = interaction.guild.id;

        try {
            const server = await getServerSetups(serverId);
            
            if (!server || !server.setups || server.setups.length === 0) {
                return interaction.reply({ 
                    content: 'No translation setups found for this server. Use `/setup` to create one.',
                    flags: 64 // MessageFlags.Ephemeral
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Translation Setups for ${interaction.guild.name}`)
                .setColor(0x0099FF)
                .setTimestamp();

            server.setups.forEach((setup, index) => {
                const channelMentions = setup.channels.map(channelId => `<#${channelId}>`).join(', ');
                const languages = setup.languages.join(', ');
                
                embed.addFields({
                    name: `${index + 1}. ${setup.name}`,
                    value: `**Channels:** ${channelMentions}\n**Languages:** ${languages}`,
                    inline: false
                });
            });

            return interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error listing setups:', error);
            return interaction.reply({ 
                content: 'There was an error retrieving the setups. Please try again later.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    }
};
