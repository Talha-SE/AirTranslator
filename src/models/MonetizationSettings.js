const mongoose = require('mongoose');

const monetizationSettingsSchema = new mongoose.Schema({
    settingsId: {
        type: String,
        default: 'global',
        unique: true
    },
    defaultFreeTranslationLimit: {
        type: Number,
        default: 20
    },
    enableGlobalRestriction: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

const MonetizationSettings = mongoose.model('MonetizationSettings', monetizationSettingsSchema);

module.exports = MonetizationSettings;
