const mongoose = require('mongoose');

const VoteCooldownSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  lastRewardedAt: { type: Date, required: true }
}, { timestamps: true });

module.exports = mongoose.model('VoteCooldown', VoteCooldownSchema);
