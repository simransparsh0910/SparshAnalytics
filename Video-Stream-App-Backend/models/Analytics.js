const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ["FRS", "VA"], 
        required: true
    },
    analytics: {
        type: [String],
        required: true,
        default: []
    }
}, { timestamps: true });

module.exports = mongoose.model("Analytics", analyticsSchema);
