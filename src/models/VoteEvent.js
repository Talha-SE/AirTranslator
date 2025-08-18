const mongoose = require('mongoose');

const VoteEventSchema = new mongoose.Schema({
    serverId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    displayName: { type: String, required: true },
    avatar: { type: String },
    creditsGranted: { type: Number, required: true, default: 0 },
    timestamp: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: ['granted', 'blocked_cooldown'], default: 'granted' }
}, { 
    timestamps: true,
    index: { timestamp: -1 } // Index for sorting by timestamp descending
});

// Compound index for efficient queries
VoteEventSchema.index({ serverId: 1, timestamp: -1 });
VoteEventSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('VoteEvent', VoteEventSchema);
