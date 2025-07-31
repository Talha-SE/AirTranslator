const mongoose = require('mongoose');

const pendingTranslationSchema = new mongoose.Schema({
    messageId: {
        type: String,
        required: true,
        unique: true
    },
    channelId: {
        type: String,
        required: true
    },
    serverId: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    sourceLanguage: String,
    targetLanguages: [String],
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    attempts: {
        type: Number,
        default: 0
    },
    lastAttemptAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

const PendingTranslation = mongoose.model('PendingTranslation', pendingTranslationSchema);

module.exports = PendingTranslation;
