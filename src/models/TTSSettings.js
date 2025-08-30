const mongoose = require('mongoose');

const ttsSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true, unique: true },
  enabled: { type: Boolean, default: false },
  // Text channel to listen for translated messages from quick setups
  textChannelId: { type: String, default: null },
  // Voice channel to speak in
  voiceChannelId: { type: String, default: null },
  // Max 2 languages to be spoken (lowercase language names to match existing usage)
  languages: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) { return Array.isArray(arr) && arr.length <= 2; },
      message: 'A maximum of 2 languages are allowed for TTS.'
    }
  },
  // Optional: custom voice names for two speakers
  voices: {
    type: {
      primary: { type: String, default: 'Zephyr' },
      secondary: { type: String, default: 'Puck' },
    },
    default: undefined,
  },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('TTSSettings', ttsSettingsSchema);
