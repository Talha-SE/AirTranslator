const mongoose = require('mongoose');

const voiceCallTranslationSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  isActive: { type: Boolean, default: false },
  voiceChannelId: { type: String, default: null },
  sourceLanguage: { type: String, default: 'auto' },
  targetLanguage: { type: String, default: null },
  model: { type: String, default: 'gemini-3.1-flash-live-preview' },
  voice: { type: String, default: 'Aoede' },
  updatedBy: { type: String, default: null },
  lastStartedAt: { type: Date, default: null },
  lastStoppedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('VoiceCallTranslation', voiceCallTranslationSchema);
