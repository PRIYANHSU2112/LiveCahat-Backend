import mongoose from 'mongoose';
import User from './src/modules/user.model.js';
import dotenv from 'dotenv';

dotenv.config();

async function updateAdmin() {
  try {
    await mongoose.connect(process.env.DATABASE_URI);
    console.log('Connected to MongoDB');

    const email = 'superadmin@livechat.com';
    const user = await User.findOne({ email });

    if (user) {
      user.password = 'SuperPassword123!';
      await user.save();
      console.log('Super Admin password updated successfully to SuperPassword123!');
    } else {
      console.log('Super Admin user not found in the database. Creating one...');
      const newUser = new User({
        type: 'ADMIN',
        firstName: 'Super',
        lastName: 'Admin',
        email: email,
        password: 'SuperPassword123!',
        mobileNumber: '0000000000',
        profileCompleted: true
      });
      await newUser.save();
      console.log('Super Admin created successfully.');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

updateAdmin();
