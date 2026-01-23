const mongoose = require('mongoose');

const VoteCooldownSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  serverId: { type: String, required: true },
  source: { type: String, required: true, default: 'topgg' }, // 'topgg' or 'official'
  lastRewardedAt: { type: Date, required: true }
}, { timestamps: true });

// Ensure unique combination of user, server, and source
// This allows users to vote for different servers independently
VoteCooldownSchema.index({ userId: 1, serverId: 1, source: 1 }, { unique: true });

module.exports = mongoose.model('VoteCooldown', VoteCooldownSchema);
