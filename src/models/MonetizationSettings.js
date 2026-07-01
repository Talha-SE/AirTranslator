const mongoose = require('mongoose');

const monetizationSettingsSchema = new mongoose.Schema({
    settingsId: {
        type: String,
        default: 'global',
        unique: true
    },
    defaultFreeTranslationLimit: {
        type: Number,
        default: 50
    },
    enableGlobalRestriction: {
        type: Boolean,
        default: false
    },
    autoUnlimitedUsageCampaignEnabled: {
        type: Boolean,
        default: true
    },
    feedbackCollectionEnabled: {
        type: Boolean,
        default: true
    },
    voteBonusAmount: {
        type: Number,
        default: 20,
        min: 1,
        max: 1000
    }
}, { timestamps: true });

const MonetizationSettings = mongoose.model('MonetizationSettings', monetizationSettingsSchema);

module.exports = MonetizationSettings;
