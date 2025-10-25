const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getServerSetups } = require('../services/databaseService');

const MAX_CHANNEL_CHARS = 350;
const MAX_LANGUAGE_CHARS = 550;

function formatList(items = [], formatter, maxLength) {
    const unique = [...new Set(items)].map(formatter).filter(Boolean);
    if (unique.length === 0) return 'None';

    const parts = [];
    let remaining = unique.length;
    let currentLength = 0;

    for (const entry of unique) {
        const separator = parts.length > 0 ? ', ' : '';
        const projectedLength = currentLength + separator.length + entry.length;

        if (projectedLength > maxLength) {
            parts.push(`+${remaining} more`);
            break;
        }

        parts.push(entry);
        currentLength = projectedLength;
        remaining -= 1;
    }

    return parts.join(', ');
}

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
                const channelMentions = formatList(setup.channels, (channelId) => `<#${channelId}>`, MAX_CHANNEL_CHARS);
                const languages = formatList(setup.languages, (lang) => lang, MAX_LANGUAGE_CHARS);

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
