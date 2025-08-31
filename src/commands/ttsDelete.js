const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const TTSSettings = require('../models/TTSSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ttsdelete')
    .setDescription('Delete the TTS setup for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      const guildId = interaction.guild.id;
      
      // Delete the TTS settings
      const result = await TTSSettings.deleteOne({ guildId });
      
      if (result.deletedCount > 0) {
        const embed = new EmbedBuilder()
          .setColor('#00A67E')
          .setTitle('🔊 TTS Setup Deleted')
          .setDescription('The TTS setup has been successfully removed for this server.')
          .setFooter({ text: 'Use /ttssetup to configure TTS again if needed.' })
          .setTimestamp();
        
        return interaction.reply({ embeds: [embed] });
      } else {
        return interaction.reply({ 
          content: '❌ No TTS setup found for this server.', 
          ephemeral: true 
        });
      }
    } catch (error) {
      console.error('ttsdelete error:', error);
      return interaction.reply({ 
        content: '❌ Failed to delete TTS setup. Please try again later.', 
        ephemeral: true 
      });
    }
  }
};
