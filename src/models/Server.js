const mongoose = require('mongoose');

const setupSchema = new mongoose.Schema({
    setupId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    channels: {
        type: [String],
        required: true
    },
    languages: {
        type: [String],
        required: true
    }
}, { _id: false });

const serverSchema = new mongoose.Schema({
    serverId: {
        type: String,
        required: true,
        unique: true
    },
    serverUniqueId: {
        type: String,
        required: true,
        unique: true
    },
    serverName: {
        type: String,
        required: true
    },
    serverWideTranslation: {
        type: Boolean,
        default: false
    },
    serverWideLanguages: {
        type: [String],
        default: []
    },
    serverWideExcludedChannels: {
        type: [String],
        default: []
    },
    translationCount: {
        type: Number,
        default: 0
    },
    toneEnabledChannels: {
        type: [String],
        default: []
    },
    threadStyleEnabled: {
        type: Boolean,
        default: false
    },
    threadStyleChannels: {
        type: [String],
        default: []
    },
    monetization: {
        freeTranslationLimit: {
            type: Number,
            default: 20
        },
        isRestricted: {
            type: Boolean,
            default: false
        },
        isExempt: {
            type: Boolean,
            default: false
        },
        lastReset: {
            type: Date,
            default: Date.now
        },
        customLimit: {
            type: Number,
            default: null // null means use global default
        }
    },
    setups: [setupSchema]
}, { timestamps: true });

const Server = mongoose.model('Server', serverSchema);

module.exports = Server;