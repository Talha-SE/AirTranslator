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
    setups: [setupSchema]
}, { timestamps: true });

const Server = mongoose.model('Server', serverSchema);

module.exports = Server;