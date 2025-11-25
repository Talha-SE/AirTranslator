const mongoose = require('mongoose');

const sttSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  inputChannelId: { type: String, default: null },
  outputChannelId: { type: String, default: null },
  model: { type: String, default: 'voxtral-mini-latest' },
  flushIntervalMs: { type: Number, default: 5000 },
  // Optional translation languages - transcription will be translated to these languages
  language1: { type: String, default: null },
  language2: { type: String, default: null },
  language3: { type: String, default: null },
  updatedBy: { type: String, default: null }, // userId of last updater
}, { timestamps: true });

module.exports = mongoose.model('STTSettings', sttSettingsSchema);
