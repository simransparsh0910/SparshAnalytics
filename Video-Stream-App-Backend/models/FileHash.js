const mongoose = require('mongoose');

const HashSchema = new mongoose.Schema({
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    hash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  });

  module.exports = mongoose.model('FileHash', HashSchema);