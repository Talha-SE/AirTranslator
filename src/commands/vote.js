const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Get the voting link for this server to earn bonus translations'),
    
    async execute(interaction) {
        try {
            const serverId = interaction.guild.id;
            const serverName = interaction.guild.name;
            
            const embed = new EmbedBuilder()
                .setTitle('🗳️ Vote for AirTranslator')
                .setDescription(`Vote for AirTranslator on Top.gg and get **10 bonus translations** for **${serverName}**!`)
                .setColor('#5865F2')
                .addFields(
                    {
                        name: '🎁 Reward',
                        value: '**10 bonus translations** will be added to this server',
                        inline: true
                    },
                    {
                        name: '⏰ Cooldown',
                        value: 'You can vote every **12 hours**',
                        inline: true
                    },
                    {
                        name: '⚡ Automatic',
                        value: 'Rewards are credited **automatically**!',
                        inline: true
                    }
                )
                .addFields({
                    name: '📋 How it works',
                    value: '1️⃣ Click the **Vote on Top.gg** button below\n2️⃣ Complete the voting process on Top.gg\n3️⃣ Your server gets 10 bonus translations within 5 minutes!\n4️⃣ No manual claiming needed - it\'s automatic!',
                    inline: false
                })
                .setFooter({
                    text: 'Thank you for supporting AirTranslator!',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            const voteButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Vote on Top.gg')
                    .setEmoji('🗳️')
                    .setURL(`https://top.gg/bot/1380177061032759416/vote?guild=${serverId}`)
                    .setStyle(ButtonStyle.Link)
            );

            await interaction.reply({
                embeds: [embed],
                components: [voteButton],
                ephemeral: false // Make it visible to everyone
            });

        } catch (error) {
            console.error('Error in vote command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('There was an error generating your vote link. Please try again later.')
                .setColor('#e74c3c');

            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
};