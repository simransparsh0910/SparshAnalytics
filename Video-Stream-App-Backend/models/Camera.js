const mongoose = require('mongoose');

const cameraSchema = new mongoose.Schema({
    streamid: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    streamname: {
        type: String,
        required: true,
        trim: true,
    },
    primarystream: {
        type: String,
        required: true,
    },
    secondarystream: {
        type: String,
        required: true,
    },
    rtspstream: {
        type: String,
        required: true,
    },
    mediaStreamPrimary: {
        type: String,
        required: true,
    },
    mediaStreamSecondary: {
        type: String,
        required: true,
    },
    analytictype: {
        type: [String],
        required: false,
    },
    status: {
        type: Boolean,
        default: true,
    },
    polygon: {
        type: [[Number]], // Array of [x, y] points
        required: false,
        default: [],
    },
    lines: {
        type: [[Number]], 
        required: false,
        default: [],
    },
    entry_line_type: {
        type: String,
    },
    exit_line_type: {
        type: String,
    },
    isUpdated: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const Camera = mongoose.model('Camera', cameraSchema);

module.exports = Camera;

