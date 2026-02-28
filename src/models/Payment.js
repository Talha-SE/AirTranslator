const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    paymentId: {
        type: String,
        required: true,
        unique: true
    },
    discordServerName: {
        type: String,
        required: true
    },
    discordUsername: {
        type: String,
        required: true
    },
    planName: {
        type: String,
        required: true,
        enum: ['Pro', 'Yearly Pass']
    },
    planType: {
        type: String,
        required: true,
        enum: ['Monthly', 'Yearly']
    },
    price: {
        type: String,
        required: true
    },
    isTrial: {
        type: Boolean,
        default: false
    },
    trialEndsAt: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'trial', 'active', 'cancelled', 'expired'],
        default: 'completed'
    },
    paymentDate: {
        type: Date,
        default: Date.now
    },
    checkoutUrl: {
        type: String,
        default: ''
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Index for efficient querying
paymentSchema.index({ discordUsername: 1, paymentDate: -1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ planType: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
