const mongoose = require("mongoose");

const parameterSchema = new mongoose.Schema({
  type: { type: String, required: true }, // e.g., "person" or "vehicle"
  attributes: {
    type: Map,
    of: mongoose.Schema.Types.Mixed, // Accepts any type (string, number, boolean, etc.)
    default: {}
  },
  count: { type: Number } // Optional count
});

const eventSchema = new mongoose.Schema({
  IP: { type: String, required: true },       
  Name: { type: String, required: true },     
  FrameData: { type: String, required: true }, 
  OriginalImage: { type: String, default: null },
  Type: { type: String, default: null },      
  Remark: { type: String, default: null },    
  Event: { type: String, required: true },    
  Description: { type: String, required: false },
  Timestamp: { type: Date, required: true },  
  Parameters: [parameterSchema]
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;

