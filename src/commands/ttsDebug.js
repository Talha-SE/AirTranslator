const { SlashCommandBuilder } = require('discord.js');
const { playBufferInChannel } = require('../services/voicePlaybackService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tts-debug')
    .setDescription('Debug TTS playback with a simple test')
    .addChannelOption(option =>
      option.setName('voice_channel')
        .setDescription('Voice channel to test in')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const voiceChannel = interaction.options.getChannel('voice_channel');
      
      if (!voiceChannel || voiceChannel.type !== 2) {
        return interaction.reply({ content: '❌ Please select a voice channel.', ephemeral: true });
      }

      const member = interaction.guild.members.cache.get(interaction.user.id);
      if (!member.voice.channelId) {
        return interaction.reply({ 
          content: '❌ You must be in a voice channel to test TTS.', 
          ephemeral: true 
        });
      }

      await interaction.deferReply();

      // Test with Mimic3 API directly
      const axios = require('axios');
      const testText = 'Hello, this is a TTS debug test.';
      const mimic3Url = process.env.MIMIC3_URL || 'http://127.0.0.1:59125';
      const voice = process.env.MIMIC3_DEFAULT_VOICE || 'en_US/ljspeech_low';

      console.log(`[TTS Debug] Testing with: ${testText}`);
      console.log(`[TTS Debug] Mimic3 URL: ${mimic3Url}`);
      console.log(`[TTS Debug] Voice: ${voice}`);

      const response = await axios.post(`${mimic3Url}/api/tts`, {
        text: testText,
        voice: voice
      }, {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/json' }
      });

      const audioBuffer = Buffer.from(response.data);
      console.log(`[TTS Debug] Generated audio: ${audioBuffer.length} bytes`);

      // Play the audio
      await playBufferInChannel(voiceChannel, audioBuffer);
      
      return interaction.editReply({ 
        content: `✅ Debug TTS test completed!\n**Stats:**\n- Audio size: ${audioBuffer.length} bytes\n- Voice: ${voice}\n- Text: "${testText}"` 
      });

    } catch (error) {
      console.error('[TTS Debug] Error:', error);
      const errorMsg = error.response?.data ? 
        `Mimic3 API Error: ${error.response.status}` : 
        `Error: ${error.message}`;
      
      return interaction.editReply({ 
        content: `❌ Debug test failed: ${errorMsg}` 
      });
    }
  }
};