const { SlashCommandBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const TTSSettings = require('../models/TTSSettings');
const { validateLanguages, assignVoices } = require('../services/ttsLanguageHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ttssetup')
    .setDescription('Configure Text-to-Speech for quick-setup translations (max 2 languages)')
    .addChannelOption(opt =>
      opt.setName('text_channel')
        .setDescription('Text channel to read translations from')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('voice_channel')
        .setDescription('Voice channel where the bot will speak')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('language1')
        .setDescription('First language to speak (e.g., English)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('language2')
        .setDescription('Second language to speak (optional)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      const guildId = interaction.guild.id;

      const textChannel = interaction.options.getChannel('text_channel');
      const voiceChannel = interaction.options.getChannel('voice_channel');

      const language1 = interaction.options.getString('language1');
      const language2 = interaction.options.getString('language2');

      const languagesInput = [language1, language2].filter(Boolean);
      const check = validateLanguages(languagesInput);
      if (!check.ok) {
        return interaction.reply({ content: `❌ ${check.error}`, flags: 64 });
      }

      const normalized = check.languages; // lowercase unique

      const settings = await TTSSettings.findOne({ guildId });
      const voices = settings?.voices || undefined;
      const { voice1, voice2 } = assignVoices(normalized, voices);

      const payload = {
        enabled: true,
        textChannelId: textChannel.id,
        voiceChannelId: voiceChannel.id,
        languages: normalized,
        voices: { primary: voice1, secondary: voice2 },
      };

      await TTSSettings.findOneAndUpdate(
        { guildId },
        { $set: payload },
        { upsert: true, new: true }
      );

      const embed = new EmbedBuilder()
        .setColor('#00A67E')
        .setTitle('🔊 TTS Enabled for Quick Setups')
        .setDescription('The bot will speak translations only for messages produced by your quick setups in the selected text channel.')
        .addFields(
          { name: 'Text Channel', value: `<#${textChannel.id}>`, inline: true },
          { name: 'Voice Channel', value: `<#${voiceChannel.id}>`, inline: true },
          { name: 'Languages', value: normalized.map((l, i) => `${i === 0 ? 'Speaker 1' : 'Speaker 2'}: **${l}**`).join('\n') }
        )
        .setFooter({ text: 'Use /ttssetup again to update settings or disable.' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 0 });
    } catch (error) {
      console.error('ttssetup error:', error);
      return interaction.reply({ content: '❌ Failed to configure TTS. Please try again later.', flags: 64 });
    }
  }
};
