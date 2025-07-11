require('dotenv').config();
const jwt = require('jsonwebtoken');
const User = require('../models/Users');
const Session = require('../models/Session');

const authenticate = async (req, res, next) => {
    const token = req.session.authToken
     console.log("token",req.session);

    if (!token) {
    //console.log("token")
        return res.status(401).json({ message: 'Not authenticated' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        //console.log("session1",decoded)
        const session = await Session.findOne({ sessionId: decoded.sessionId });
        if (!session || session.expiresAt < new Date()) {
        //console.log("session",session)
            return res.status(401).json({ message: "Not authenticated" });
        }
        const username = decoded.username
        const user = await User.findOne({username}).populate('role');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        req.user = {
            id: user._id,
            role: user.role.name,
            username: user.username,
            rights: decoded.rights,
            sessionId: decoded.sessionId
        };
        next();
    } 
    catch (error) {
        const decoded = jwt.decode(token);
        if (decoded && decoded.sessionId) {
            try {
                // Delete the session from the database
                await Session.deleteOne({ sessionId: decoded.sessionId });
            } catch (err) {
                console.error("Session deletion failed:", err);
            }
        }

        return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
};

module.exports = {authenticate}

