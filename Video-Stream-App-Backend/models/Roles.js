const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    rights: [
        {
            name: {
                type: String,
                required: true
            },
            description: {
                type: String
            },
            enabled: {
                type: Boolean,
                default: true
            }
        }
    ]
},
{
  strictQuery: true,
}

);

// Create the Role model
module.exports = mongoose.model('Role', RoleSchema);


