const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const TTSSettings = require('../models/TTSSettings');
const { getVoiceOptions, getAllLanguagesWithVoices, findVoiceByName } = require('../services/ttsLanguageHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ttsvoice')
    .setDescription('Select specific voices for TTS languages')
    .addStringOption(opt =>
      opt.setName('language')
        .setDescription('Enter the language name (e.g., english, spanish, french)')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      const guildId = interaction.guild.id;
      const inputLanguage = interaction.options.getString('language').toLowerCase().trim();

      // Check if TTS is configured for this server
      const ttsSettings = await TTSSettings.findOne({ guildId });
      if (!ttsSettings || !ttsSettings.enabled) {
        return interaction.reply({ 
          content: '❌ TTS is not configured for this server. Use `/ttssetup` first.', 
          ephemeral: true 
        });
      }

      // Find the language in the server's TTS setup (case insensitive)
      const selectedLanguage = ttsSettings.languages.find(lang => 
        lang.toLowerCase() === inputLanguage
      );

      if (!selectedLanguage) {
        const availableLanguages = getAllLanguagesWithVoices();
        const suggestions = availableLanguages.filter(lang => 
          lang.toLowerCase().includes(inputLanguage) || inputLanguage.includes(lang.toLowerCase())
        ).slice(0, 5);

        let errorMsg = `❌ Language "${inputLanguage}" is not configured for TTS in this server.\n\n`;
        errorMsg += `**Current languages**: ${ttsSettings.languages.join(', ')}\n`;
        
        if (suggestions.length > 0) {
          errorMsg += `\n**Did you mean**: ${suggestions.join(', ')}?`;
        } else {
          errorMsg += `\n**Available languages**: ${availableLanguages.slice(0, 10).join(', ')}${availableLanguages.length > 10 ? '...' : ''}`;
        }

        return interaction.reply({ 
          content: errorMsg,
          ephemeral: true 
        });
      }

      const voiceOptions = getVoiceOptions(selectedLanguage);
      if (!voiceOptions) {
        return interaction.reply({ 
          content: `❌ No voice options available for "${selectedLanguage}".`, 
          ephemeral: true 
        });
      }

      // Create select menu for male voices
      const maleSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`tts_voice_male_${selectedLanguage}`)
        .setPlaceholder('Select a male voice')
        .addOptions(
          voiceOptions.male.map(voice => ({
            label: voice.name,
            value: voice.voice,
            description: `Voice ID: ${voice.voice}`
          }))
        );

      // Create select menu for female voices
      const femaleSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`tts_voice_female_${selectedLanguage}`)
        .setPlaceholder('Select a female voice')
        .addOptions(
          voiceOptions.female.map(voice => ({
            label: voice.name,
            value: voice.voice,
            description: `Voice ID: ${voice.voice}`
          }))
        );

      const maleRow = new ActionRowBuilder().addComponents(maleSelectMenu);
      const femaleRow = new ActionRowBuilder().addComponents(femaleSelectMenu);

      // Get current voice setting for this language
      const currentVoice = ttsSettings.languages[0] === selectedLanguage 
        ? ttsSettings.voices?.primary 
        : ttsSettings.voices?.secondary;

      const currentVoiceInfo = currentVoice 
        ? [...voiceOptions.male, ...voiceOptions.female].find(v => v.voice === currentVoice)
        : null;

      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle(`🎙️ Voice Selection for ${selectedLanguage.charAt(0).toUpperCase() + selectedLanguage.slice(1)}`)
        .setDescription('Choose a voice for this language. Select from male or female options below.')
        .addFields(
          { 
            name: 'Current Voice', 
            value: currentVoiceInfo ? `${currentVoiceInfo.name} (${currentVoiceInfo.voice})` : 'Default', 
            inline: false 
          },
          { name: '👨 Male Voices', value: `${voiceOptions.male.length} options available`, inline: true },
          { name: '👩 Female Voices', value: `${voiceOptions.female.length} options available`, inline: true }
        )
        .setFooter({ text: 'Voice changes will take effect immediately for new TTS messages.' })
        .setTimestamp();

      return interaction.reply({ 
        embeds: [embed], 
        components: [maleRow, femaleRow],
        ephemeral: true 
      });

    } catch (error) {
      console.error('ttsvoice error:', error);
      return interaction.reply({ 
        content: '❌ Failed to load voice options. Please try again later.', 
        ephemeral: true 
      });
    }
  }
};