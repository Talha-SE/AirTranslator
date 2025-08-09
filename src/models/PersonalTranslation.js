const mongoose = require('mongoose');

const personalTranslationSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    enabled: {
        type: Boolean,
        default: false
    },
    targetLanguages: [{
        type: String,
        required: true
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUsed: {
        type: Date,
        default: Date.now
    },
    translationCount: {
        type: Number,
        default: 0
    }
});

// Update lastUsed when translation is performed
personalTranslationSchema.methods.recordTranslation = function() {
    this.lastUsed = new Date();
    this.translationCount += 1;
    return this.save();
};

module.exports = mongoose.model('PersonalTranslation', personalTranslationSchema);
