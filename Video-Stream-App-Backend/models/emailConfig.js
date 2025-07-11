const mongoose = require('mongoose');

const emailConfig = new mongoose.Schema({
    host: {
        type: String,
        required: true,
        default: 'smtp.gmail.com',
    },
    port: {
        type: Number,
        required: true,
        default: 587,
    },
    secure: {
        type: Boolean,
        required: true,
        default: false,
    },
    username: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
})    

module.exports = mongoose.model('emailConfigs', emailConfig);

