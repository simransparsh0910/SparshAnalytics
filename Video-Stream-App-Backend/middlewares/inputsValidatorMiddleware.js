const { body, validationResult } = require('express-validator');

// Validation middleware for signup
const validateSignup = [
    body('name')
        .notEmpty().withMessage('Name is required')
        .matches(/^[a-zA-Z0-9@._-]+$/).withMessage('Name can only contain letters, numbers, and special characters (@, ., _, -)')
        .isString().withMessage('Name must be a string'),

    body('email')
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email format'),

    body('username')
        .notEmpty().withMessage('Username is required')
        .matches(/^[a-zA-Z0-9@._-]+$/).withMessage('Username can only contain letters, numbers, and special characters (@, ., _, -)')
        .isLength({ min: 3 }).withMessage('Username must be at least 3 characters long'),

    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/^[a-zA-Z0-9@#\-_.!$%^&*]+$/)
        .withMessage('Password can only contain letters, numbers, and special characters (@, #, -, _, ., !, $, %, ^, &, *)'),
];

// Validation middleware for login
const validateLogin = [
    body('username')
        .notEmpty().withMessage('Username is required'),
    body('password')
        .notEmpty().withMessage('Password is required'),
];

// Validation middleware for camera
const validateCamera = [
  // Validate Stream ID
  body('streamid')
    .notEmpty().withMessage('Stream ID is required')
    .isAlphanumeric().withMessage('Stream ID must be alphanumeric')
    .isString().withMessage('Stream ID must be a string'),

  // Validate Stream Name
  body('streamname')
    .notEmpty().withMessage('Stream Name is required')
    .matches(/^[a-zA-Z0-9@._-]+$/).withMessage(
      'Stream Name can only contain letters, numbers, and special characters (@, ., _, -)'
    )
    .isString().withMessage('Stream Name must be a string'),

  // Validate Primary Stream URL
  body('primarystream')
    .notEmpty().withMessage('Primary Stream is required')
    .matches(/^(https?:\/\/|ftp:\/\/|rtsp:\/\/)([^\s]+)(:\d+)?(\/[^\s]*)?$/)
    .withMessage('Primary Stream must be a valid URL starting with http, https, ftp, or rtsp'),

  // Validate Secondary Stream URL
  body('secondarystream')
    .notEmpty().withMessage('Secondary Stream is required')
    .matches(/^(https?:\/\/|ftp:\/\/|rtsp:\/\/)([^\s]+)(:\d+)?(\/[^\s]*)?$/)
    .withMessage('Secondary Stream must be a valid URL starting with http, https, ftp, or rtsp'),

  // Validate Analytic Type
  /*
  body('analytictype')
    .isArray({ min: 1 }).withMessage('Analytic Type must be an array with at least one value')
    .custom((array) => {
      const allowedTypes = ['frs', 'fire-detection', 'train-stoppage', 'intrusion', 'object-abandon', 'crowd'];
      const invalidTypes = array.filter(type => !allowedTypes.includes(type));
      if (invalidTypes.length > 0) {
        throw new Error(`Invalid analytic type(s): ${invalidTypes.join(', ')}`);
      }
      return true;
    }),
    */

  // Validate Status (Optional Boolean)
  body('status')
    .optional()
    .isBoolean().withMessage('Status must be a boolean (true or false)'),
];


const validateAddFace = [
    body('personName')
      .notEmpty().withMessage('Person Name is required')
      .isString().withMessage('Person Name must be a string')
      .matches(/^[a-zA-Z\s]+$/).withMessage('Person Name can only contain letters and spaces'),
    
   
  
    body('remarks')
      .optional()
      .isString().withMessage('Remarks must be a string')
      .isLength({ max: 500 }).withMessage('Remarks must not exceed 500 characters'),
  
    body('group')
      .notEmpty().withMessage('Group is required')
      .isString().withMessage('Group must be a string'),
  
    body('status')
      .notEmpty().withMessage('Status is required')
      .isIn(['whitelist', 'blacklist']).withMessage('Status must be either "whitelist" or "blacklist"'),
];

const validateRole = [
    body('roleName')
      .notEmpty().withMessage('Role Name is required')
      .isString().withMessage('Role Name must be a string')
      .matches(/^[a-zA-Z0-9\s]+$/).withMessage('Role Name can only contain letters, numbers, and spaces')
      .isLength({ min: 3 }).withMessage('Role Name must be at least 3 characters long')
      .isLength({ max: 20 }).withMessage('Role Name cannot exceed 20 characters'),
];

// Error handling middleware
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

module.exports = {
    validateSignup,
    validateLogin,
    validateCamera,
    validateAddFace,
    validateRole,
    handleValidationErrors,
};

