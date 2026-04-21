const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    username: {
        type: String,
        default: null
    },
    globalName: {
        type: String,
        default: null
    },
    avatar: {
        type: String,
        default: null
    },
    answers: {
        dashboardExperience: {
            type: String,
            enum: ['love_it', 'okay', 'needs_work'],
            required: true
        },
        planType: {
            type: String,
            enum: ['free', 'paid', 'trial'],
            required: true
        },
        usageReason: {
            type: String,
            enum: ['community', 'gaming', 'business', 'friends', 'other'],
            required: true
        },
        recommendScore: {
            type: String,
            enum: ['yes', 'maybe', 'no'],
            required: true
        },
        improvementSuggestion: {
            type: String,
            default: '',
            maxlength: 500
        }
    },
    meta: {
        locale: {
            type: String,
            default: null
        },
        userAgent: {
            type: String,
            default: null
        }
    }
}, { timestamps: true });

const Feedback = mongoose.model('Feedback', feedbackSchema);

module.exports = Feedback;
