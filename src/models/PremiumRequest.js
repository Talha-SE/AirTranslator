const mongoose = require('mongoose');

const premiumRequestSchema = new mongoose.Schema({
  serverId: { type: String, required: true, index: true },
  serverName: { type: String, default: 'Unknown Server' },
  requesterUserId: { type: String, required: true },
  requesterUsername: { type: String, required: true },
  requesterDisplayName: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  proofLink: { type: String },
  notes: { type: String },
  approvedBy: { type: String },
  approvedAt: { type: Date },
  durationDays: { type: Number },
  expiresAt: { type: Date }
}, { timestamps: true });

premiumRequestSchema.index({ serverId: 1, status: 1 });

const PremiumRequest = mongoose.model('PremiumRequest', premiumRequestSchema);

module.exports = PremiumRequest;
