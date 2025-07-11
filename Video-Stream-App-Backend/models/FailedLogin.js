const mongoose = require('mongoose');

const FailedLoginSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  username: String,
  ip_address: String,
  timestamp: {
    type: Date,
    default: Date.now,
  },
  blocked_time: {
    type: Date,
    default: null,
  },
});

module.exports = mongoose.model('FailedLogin', FailedLoginSchema);
