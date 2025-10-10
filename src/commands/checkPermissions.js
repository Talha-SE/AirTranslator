const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('check-permissions')
    .setDescription('Check bot permissions for TTS'),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      const botMember = guild.members.cache.get(interaction.client.user.id);
      
      const permissions = {
        'Connect': botMember.permissions.has(PermissionFlagsBits.Connect),
        'Speak': botMember.permissions.has(PermissionFlagsBits.Speak),
        'Use VAD': botMember.permissions.has(PermissionFlagsBits.UseVAD),
        'Send Messages': botMember.permissions.has(PermissionFlagsBits.SendMessages),
        'View Channel': botMember.permissions.has(PermissionFlagsBits.ViewChannel)
      };

      const permissionsList = Object.entries(permissions)
        .map(([perm, has]) => `${has ? '✅' : '❌'} ${perm}`)
        .join('\n');

      const embed = {
        title: '🔍 Bot Permission Check',
        description: permissionsList,
        color: Object.values(permissions).every(p => p) ? 0x00ff00 : 0xff9900,
        footer: {
          text: 'All permissions should be ✅ for TTS to work properly'
        }
      };

      return interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
      console.error('Permission check error:', error);
      return interaction.reply({ 
        content: '❌ Failed to check permissions.', 
        ephemeral: true 
      });
    }
  }
};