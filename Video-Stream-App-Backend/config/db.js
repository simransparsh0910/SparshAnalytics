require('dotenv').config();
const Role = require('../models/Roles');
const Users = require('../models/Users');
const mongoose = require('mongoose');
const bcrypt = require("bcrypt")


const connectDB = async () => {
  const conn = await mongoose.connect("mongodb://mongodb:27017/", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
};

const createAdminRoleAndUser = async () => { 
 try {
    const allRights = [
        { name: 'Add Face', description: 'Can add face to the system' },
        { name: 'Delete Face', description: 'Can delete face from the system' },
        { name: 'Add Camera', description: 'Can add a camera to the system' },
        { name: 'Delete Camera', description: 'Can delete a camera from the system' },
        { name: 'View Playback', description: 'Can view playback of activities' },
    ];

        // Check if the Admin role already exists
        const existingAdminRole = await Role.findOne({ name: 'SuperAdmin' });

        if (existingAdminRole) {
            console.log('Admin role already exists:', existingAdminRole);
            return;
        }

        // Create a new Admin role with all rights
        const adminRole = new Role({
            name: 'SuperAdmin',
            rights: allRights,
        });

        const savedRole = await adminRole.save();
       console.log('New Admin role created with all rights:', savedRole);

//       Create Admin User with the Admin Role
       const hashedPassword = await bcrypt.hash('Superadmin890@#', 10);
       const isSuperAdmin = await Users.findOne({ name: 'SuperAdmin' });

      if (isSuperAdmin) {
          console.log('SuperAdmin user already exists:', isSuperAdmin);
          return;
      }
    const adminUser = new Users({
           username: 'admin@admin.com',
           name: 'SuperAdmin',
           email:"admin@gmail.com",
           password: hashedPassword,
           role: savedRole._id
       });

       const savedUser = await adminUser.save();
       console.log('Admin user saved:', savedUser);
  } catch (error) {
      console.error('Error creating admin role and user:', error);
  }
};


module.exports =  { connectDB, createAdminRoleAndUser};
