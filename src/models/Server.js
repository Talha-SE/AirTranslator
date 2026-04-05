const mongoose = require('mongoose');

const setupSchema = new mongoose.Schema({
    setupId: {
        type: String,
        required: true
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
    autoCleanup: {
        serverWide: {
            enabled: {
                type: Boolean,
                default: false
            },
            delay: {
                type: Number,
                default: 0
            }
        },
        channels: {
            type: Map,
            of: new mongoose.Schema({
                enabled: {
                    type: Boolean,
                    default: false
                },
                delay: {
                    type: Number,
                    default: 0
                }
            }, { _id: false }),
            default: {}
        }
    },
    monetization: {
        freeTranslationLimit: {
            type: Number,
            default: 20
        },
        isRestricted: {
            type: Boolean,
            default: true
        },
        isExempt: {
            type: Boolean,
            default: false
        },
        exemptUntil: {
            type: Date,
            default: null
        },
        premiumJoinedAt: {
            type: Date,
            default: null
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

// Ensure setup IDs are unique per server (not globally across the collection)
// Use a compound partial unique index so documents without setups do not clash on null
serverSchema.index(
    { serverId: 1, 'setups.setupId': 1 },
    { unique: true, partialFilterExpression: { 'setups.setupId': { $exists: true } } }
);

const Server = mongoose.model('Server', serverSchema);

module.exports = Server;