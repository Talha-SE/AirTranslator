const { SlashCommandBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const TTSSettings = require('../models/TTSSettings');
const { validateLanguages, getVoiceOptions } = require('../services/ttsLanguageHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ttssetup')
    .setDescription('Configure Text-to-Speech for quick-setup translations (max 2 languages)')
    .addChannelOption(opt =>
      opt.setName('text_channel')
        .setDescription('Text channel to read translations from (voice channels also have text chat)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
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

      const payload = {
        enabled: true,
        textChannelId: textChannel.id,
        voiceChannelId: voiceChannel.id,
        languages: normalized,
      };

      await TTSSettings.findOneAndUpdate(
        { guildId },
        { $set: payload },
        { upsert: true, new: true }
      );

      // Build voice selection menus (male/female) for each provided language
      const rows = [];
      normalized.forEach((lang) => {
        const options = getVoiceOptions(lang);
        if (!options) return; // skip if no options for this language

        const maleVoices = (options.male || []).slice(0, 25);
        const femaleVoices = (options.female || []).slice(0, 25);

        if (maleVoices.length) {
          const maleSelect = new StringSelectMenuBuilder()
            .setCustomId(`tts_voice_male_${lang}`)
            .setPlaceholder(`Select a male voice for ${lang}`)
            .addOptions(
              maleVoices.map(v => ({
                label: v.name.substring(0, 100),
                value: v.voice,
                description: `ID: ${v.voice}`.substring(0, 100)
              }))
            );
          rows.push(new ActionRowBuilder().addComponents(maleSelect));
        }

        if (femaleVoices.length) {
          const femaleSelect = new StringSelectMenuBuilder()
            .setCustomId(`tts_voice_female_${lang}`)
            .setPlaceholder(`Select a female voice for ${lang}`)
            .addOptions(
              femaleVoices.map(v => ({
                label: v.name.substring(0, 100),
                value: v.voice,
                description: `ID: ${v.voice}`.substring(0, 100)
              }))
            );
          rows.push(new ActionRowBuilder().addComponents(femaleSelect));
        }
      });

      const embed = new EmbedBuilder()
        .setColor('#00A67E')
        .setTitle('🔊 TTS Enabled for Quick Setups')
        .setDescription('The bot will speak translations only for messages produced by your quick setups in the selected text channel.')
        .addFields(
          { name: 'Text Channel', value: `<#${textChannel.id}>`, inline: true },
          { name: 'Voice Channel', value: `<#${voiceChannel.id}>`, inline: true },
          { name: 'Languages', value: normalized.map((l, i) => `${i === 0 ? 'Speaker 1' : 'Speaker 2'}: **${l}**`).join('\n') }
        )
        .setFooter({ text: rows.length ? 'Pick voices below to customize. Use /ttssetup again to update or disable.' : 'Use /ttssetup again to update settings or disable.' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], components: rows, flags: 0 });
    } catch (error) {
      console.error('ttssetup error:', error);
      return interaction.reply({ content: '❌ Failed to configure TTS. Please try again later.', flags: 64 });
    }
  }
};
