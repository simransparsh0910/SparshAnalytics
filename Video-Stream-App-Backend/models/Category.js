const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  threshold: {
    type: Number,
    required: true,
  },
  remark: {
    type: String,
    required: true,
    trim: true,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt fields automatically
});

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;

