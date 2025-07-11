require('dotenv').config();
const express = require("express");
const https = require("https")
const app = express();
const zmq = require('zeromq');
const WebSocket = require('ws');
const bcrypt = require("bcrypt")
const path = require("path")
const fs = require("fs")
const jwt = require("jsonwebtoken");
const ip = require('request-ip');
const UserLogs = require('./models/UserLogs');
const LoginAttempts = require('./models/FailedLogin'); 
const User = require("./models/Users")
const Role = require("./models/Roles")
const Camera = require('./models/Camera');
const Session = require('./models/Session');
const Category = require("./models/Category");
const Event = require('./models/Event');
const Analytics = require("./models/Analytics");
const emailConfig = require('./models/emailConfig');
const { connectDB,createAdminRoleAndUser } = require('./config/db');
const {authenticate} = require('./middlewares/authMiddleware')
const cors = require("cors")
const CryptoJS = require('crypto-js');
const bodyParser = require("body-parser");
const cookieParser = require('cookie-parser');
const csrf = require("csurf");
const helmet = require("helmet")
const rateLimit = require('express-rate-limit');
const sanitize = require('mongo-sanitize');
const svgCaptcha = require('svg-captcha');
let nodemailer = require('nodemailer');
const session = require('express-session');
const yaml = require('js-yaml');
const { validateCamera,validateSignup, validateLogin, validateAddFace, validateRole, handleValidationErrors } = require('./middlewares/inputsValidatorMiddleware');

const { initializeHashesForFolders, verifyFileIntegrityForFolders, verifyLicenseFile} = require("./FileHash");
  
const YAML_FILE_PATH = path.resolve(process.cwd(), "../media_server/mediamtx.yml")
const YAML = require("js-yaml");

const foldersToMonitor = [
'/video-stream-app/src',
'/video-stream-app/src/components',
];


const globalLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes
    max: 500, 
    standardHeaders: true, 
    legacyHeaders: false, 
    message: 'Too many requests from this IP, please try again later.',
});

// Apply the rate limiter to all requests
app.use(cookieParser());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(helmet());
//app.use(globalLimiter);

const allowedOrigins = [
  `https://${process.env.FRONTEND_HOST}:3000`,
  `https://${process.env.FRONTEND_HOST}`,
  "https://127.0.0.1/"
]
console.log(process.env.FRONTEND_HOST,"frontend host")
app.use(cors({
  origin: (origin, callback) => {
  console.log(origin)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
   }
   return callback(new Error('Not allowed by CORS'), false);
 },
 methods: ['GET', 'POST', 'PUT', 'DELETE'],
 allowedHeaders: ['Content-Type', 'Authorization', 'X-XSRF-TOKEN','Access-Control-Allow-Origin'],
 credentials: true,
}));

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'yourSecretKey',
        resave: false,
        saveUninitialized: false,
        cookie: {
        httpOnly: true,   // HTTP-only for security
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', // Allow cross-origin requests
    },
        
    }),
);

app.use(helmet.frameguard({ action: 'SAMEORIGIN' }));
app.use(
    helmet.contentSecurityPolicy({
        useDefaults: true, // Disable default Helmet CSP
        directives: {
       // 'default-src': ["'none'"], // Disallow everything by default
        'script-src': ["'self'"],  // Allow scripts only from the same origin
        'style-src': ["'self'", "'unsafe-inline'"], // Allow styles and inline CSS
        'img-src': [
            "'self'",
            'data:',
            `http://${process.env.HOST}:8080`,
            `https://${process.env.HOST}:3000`,
            `wss://${process.env.HOST}:9000`,
            "https://127.0.0.1/"
        ],
        'font-src': ["'self'"], // Allow fonts from the same origin
        'connect-src': [
            "'self'",
            `https://${process.env.HOST}:3000`,
            `https://${process.env.HOST}:8080`,
            `wss://${process.env.HOST}:9000`,
            "https://127.0.0.1/"
        ],
        //'frame-src': ["'none'"],         // Block iframes
        //'object-src': ["'none'"],        // Block plugins
        //'child-src': ["'none'"],         // Prevent any child frame loading
        'form-action': ["'self'"],       // Allow form submissions only from the same origin
        'base-uri': ["'self'"],          // Allow only the current site as the base URL
        //'frame-ancestors': ["'none'"],   // Prevent embedding into iframes
        },
        //reportOnly: false, // Set to `true` if you want to test the policy first
        crossOriginResourcePolicy: { 
            policy: 'cross-origin' 
        },
        strictTransportSecurity: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true, // Enforce HSTS for subdomains as well
            preload: true, // Allow preloading of the HSTS policy
        },
        noSniff: true,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // Prevent leaking referrer information
        featurePolicy: {
            features: {
            //   Disable access to geolocation, camera, and microphone
                geolocation: ["'none'"],
                camera: ["'none'"],
                microphone: ["'none'"],
            },
        },
    })
);

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache'); // HTTP/1.0 backward compatibility
    next();
})

app.use((req, res, next) => {
    res.removeHeader('Server');
    res.removeHeader('Set-Cookie');
    next();
});

app.set('trust proxy', true);

const csrfProtection = csrf({
    cookie: {
        httpOnly: true,   // HTTP-only for security
        secure: true,     // Send cookie over HTTPS
        sameSite: 'Strict', // Allow cross-origin requests
    }
});
//Replace Below line with "connectDB().then(createAdminRoleAndUser())" on new setup only,run the server when see the logs for the creation of Superadmin then back to "connectDB()"
connectDB()
.then(createAdminRoleAndUser())
.then(async () => {
    // Initialize hashes
    console.log("Initializing file hashes...");    
    await initializeHashesForFolders(foldersToMonitor);

    await verifyFileIntegrityForFolders();
})

// Websocket
const server = https.createServer({
   cert: fs.readFileSync(path.join(__dirname, 'selfsigned.crt')),
   key: fs.readFileSync(path.join(__dirname, 'selfsigned.key'))
}, (req, res) => {
  res.writeHead(200);
  res.end('Hello, HTTPS Server!');
});

// Create a WebSocket server that listens on the HTTPS server
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
console.log('Client connected new ws');
  ws.on('message', message => {
    console.log('received: %s', message);
  });
});

// Start server on port 3000
server.listen(9000, () => {
  console.log('WebSocket server running on 9000');
});

//const wss = new WebSocket.Server({ port: process.env.WEBSOCKET_PORT });

const sock = new zmq.Subscriber();
const pubSocket = new zmq.Publisher();
const vaPubsocket = new zmq.Publisher()
sock.subscribe("");

let isLiveCaptureEnabled = false;
let catVal = ""
let totalCameraToBeAdded = 0;
let totalAnalyticsToBeAdded = 0;


async function saveEvent(data) {
    console.log("Enter in Save event data")
    try {
        const parsedData = { ...data, GroupName:catVal };
      console.log("📡 Forwarding Event Data to Python Server via ZMQ");
  
      const zmqPayload = {
        Topic: "auto_enrollment",
        ...parsedData, // includes all event info
      };
  
      await pubSocket.send(JSON.stringify(zmqPayload));
      console.log("✅ Event data sent to Python server via ZMQ");
  
    } catch (error) {
      console.error("❌ Error sending event via ZMQ:", error);
    }
}

async function saveEventData(data) {
    try {
        let parsedData = data;
        console.log(parsedData, "parsed data");

        // Safely handle Parameters
        const parametersArray = Array.isArray(parsedData.Parameters)
            ? parsedData.Parameters
            : parsedData.Parameters ? [parsedData.Parameters] : [];

        const newEvent = new Event({
            IP: parsedData.DeviceId,
            Name: parsedData.PersonName,
            FrameData: parsedData.DetectedImage,
            OriginalImage: parsedData.OriginalImage || null,
            Type: parsedData.Type || null,
            Remark: parsedData.Remark || null,
            Event: parsedData.Event,
            Description: parsedData.Description || "",
            Timestamp: new Date(parsedData.Timestamp),
            Parameters: parametersArray
                .filter(param => param && typeof param === "object")
                .map(param => ({
                    type: param.type || undefined,
                    attributes: param.attributes || {},
                    count: param.count || undefined
                }))
        });

        await newEvent.save();
        console.log("Event saved successfully!");
    } catch (error) {
        console.error("Error saving event:", error);
    }
}

(async () => {
    try {
        await sock.bind(`tcp://${process.env.ZMQ_SUB_PORT}`);
        console.log("Subscriber connected to port", process.env.ZMQ_SUB_PORT);

        let buffer = [];

        // Handle WebSocket connections
        wss.on("connection", (ws) => {
            console.log("Client connected", new Date());

            while (buffer.length > 0) {
                const bufferedData = buffer.shift();
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(bufferedData));
                }
            }

            ws.on("message", (message) => {
                const parsedMessage = JSON.parse(message);
                // Optionally handle incoming messages
            });

            ws.on("close", () => {
                console.log("Client disconnected");
            });

            ws.on("error", (e) => {
                console.log("Client error", e);
            });
        });

        // Main loop to receive ZMQ messages
        while (true) {
            let data = await sock.receive();
            let newEventsData = data.toString();
            let parsedData;

            try {
                parsedData = JSON.parse(newEventsData);
            } catch (jsonError) {
                console.error("JSON parsing error:", jsonError.message);
                continue;
            }

            if (typeof parsedData === "object" && "detectedData" in parsedData) {
                console.log("Detected data via WebSocket");
                const message = {
                    type: "detectedData",
                    data: newEventsData,
                    dirName: path.resolve(__dirname, ".."),
                };

                if (wss.clients.size > 0) {
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(message));
                        }
                    });
                } else {
                    console.log("No clients, buffering detected data.");
                    buffer.push(message);
                }

            } else if (Array.isArray(parsedData)) {
                console.log("Person data via WebSocket");
                const message = {
                    type: "personData",
                    data: newEventsData,
                };

                if (wss.clients.size > 0) {
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(message));
                        }
                    });
                } else {
                    console.log("No clients, buffering person data.");
                    buffer.push(message);
                }

            } else if (typeof parsedData === "object") {
                console.log("General data via WebSocket");
                const eventType = parsedData?.Event;

                // Always save to DB (even if no clients)
                if (eventType === "FaceDetected") {
                    // console.log(isLiveCaptureEnabled,"isEnabled")
                  if (isLiveCaptureEnabled) {
                    // console.log("Enter is auto enrollment.........................................//////////.............")
                    saveEvent(parsedData); // primary save
                  }
                  saveEventData(parsedData); // always save to eventData for Face_Detected
                }

                // Save for VA
               if (eventType !== "FaceDetected") {
                    saveEventData(parsedData);
                }

                // Prepare appropriate message
                let message;

                if (parsedData?.Event === "SimilarFaceDetected") {
                    message = {
                        type: "faceAlert",
                        data: parsedData,
                    };
                } else if (parsedData?.Event === "FaceSaved") {
                    message = {
                        type: "faceSaved",
                        data: parsedData,
                    };
                }else if (parsedData?.Event === "TotalCameraResponse") {
                    totalCameraToBeAdded = parsedData.num_cameras;
                    totalAnalyticsToBeAdded = parsedData.num_analytics;
                    console.log(totalAnalyticsToBeAdded,totalCameraToBeAdded,"Camera Details..////........../////........")
                } 
                else {
                    message = {
                        type: "generalData",
                        data: newEventsData,
                    };
                }

                // Send to WebSocket clients if available
                if (wss.clients.size > 0) {
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(message));
                        }
                    });
                } else {
                    console.log("No clients, buffering general data.");
                    buffer.push(message);
                }
            }
        }
    } catch (err) {
        console.error("Error receiving message:", err);
    }
})();


(async () => {
    await pubSocket.connect(`tcp://${process.env.ZMQ_PUB_PORT}`);
    console.log('Publisher bound to port 5020');
  })();
  
  (async () => {
    await vaPubsocket.connect(`tcp://${process.env.ZMQ_VA_PUB_PORT}`);
    console.log('Publisher bound to port 5010');
  })();
  
  
  app.get('/api/get-toggle-capture', (req, res) => {
    console.log("📸 Live capture flag set to:", isLiveCaptureEnabled);
    res.json({ success: true, status: isLiveCaptureEnabled });
  });
  
  app.post('/api/toggle-capture', (req, res) => {
    const { autoEnrollment,category } = req.body;
    catVal = category;
    isLiveCaptureEnabled = autoEnrollment;
    console.log("📸 Live capture flag set to:", isLiveCaptureEnabled);
    res.json({ success: true, status: isLiveCaptureEnabled });
  });
  
  app.post('/api/toggle-capture-disable', (req, res) => {
    const { autoEnrollment } = req.body;
    // catVal = category;
    isLiveCaptureEnabled = autoEnrollment;
    console.log("📸 Live capture flag set to:", isLiveCaptureEnabled);
    res.json({ success: true, status: isLiveCaptureEnabled });
  });


const BLOCK_TIME = 5;

// Function to log an action in UserLogs
const logAction = async (userId, username, action, status, ipAddress) => {
  await UserLogs.create({
    user_id: userId || null,
    username,
    action,
    ip_address: ipAddress,
    status,
    timestamp: new Date(),
  });
};

// Function to handle failed login attempts
const handleFailedLogin = async (userId, username, clientIp) => {
    const failedAttempts = await LoginAttempts.find(userId ? { user_id: userId } : { username });

    const newAttempt = {
        user_id: userId || null,
        username,
        ip_address: clientIp,
        timestamp: new Date(),
    };

    if (failedAttempts.length === 4) {
    // Add blocked_time on the 5th failed attempt
        newAttempt.blocked_time = new Date(Date.now() + BLOCK_TIME * 60 * 1000);
    }

    console.log(failedAttempts.length)
    await LoginAttempts.create(newAttempt);

    return failedAttempts;
};

// Function to check if a user is blocked
const isBlocked = async (failedAttempts) => {
  if ((failedAttempts.length+1) >= 5) {
    const lastAttempt = failedAttempts[failedAttempts.length - 1];
    const blockStartTime = new Date(lastAttempt.blocked_time || lastAttempt.timestamp);
    const timeSinceBlockStart = Date.now() - blockStartTime.getTime();

    if (timeSinceBlockStart < BLOCK_TIME) {
      const remainingTime = Math.ceil((BLOCK_TIME - timeSinceBlockStart) / 1000 / 60); // Remaining time in minutes
      return { blocked: true, remainingTime };
    }
  }

  return { blocked: false };
};

// Function to clear failed login attempts
const clearFailedAttempts = async (userId, username) => {
  await LoginAttempts.deleteMany(userId ? { user_id: userId } : { username });
};

const decrypt = (encryptedData, secret) => {
    const bytes = CryptoJS.AES.decrypt(encryptedData, secret);
    return bytes.toString(CryptoJS.enc.Utf8);
};

//const decryptData = (encryptedData, secret) => {
  //  const bytes = CryptoJS.AES.decrypt(encryptedData, secret);
    //return bytes.toString(CryptoJS.enc.Utf8);
//};


app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// POST a new category
app.post("/api/categories", async (req, res) => {
  const { name, threshold, remark } = req.body;

  if (!name || threshold === undefined || !remark) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const newCategory = new Category({ name, threshold, remark });
    await newCategory.save();

    // Send category to Python server via pub socket
    const message = {
        name,
        threshold,
        remark,
        Topic: "new category",
      
    };

    try {
      await pubSocket.send(JSON.stringify(message));
      console.log("Sent new category to Python server");
    } catch (err) {
      console.error("Error sending category to Python server:", err.message);
      // Still respond success even if pub send fails
    }

    res.status(201).json(newCategory);
  } catch (err) {
    console.error("Error saving category:", err.message);
    res.status(500).json({ error: "Failed to create category" });
  }
});


let captchaText = '';

// Endpoint to generate a CAPTCHA
app.get('/api/generate-captcha', (req, res) => {
     const captcha = svgCaptcha.create({ size: 6, noise: 2 });
     console.log(captcha)
     captchaText = captcha.text; // Store CAPTCHA text in the session
    res.type('svg').send(captcha.data);
});

// Endpoint to validate the CAPTCHA
app.post('/api/validate-captcha', (req, res) => {
    const { userCaptcha } = req.body;

    if (userCaptcha === req.session.captcha) {
        return res.json({ success: true, message: 'CAPTCHA validation passed!' });
    }
    res.status(400).json({ success: false, message: 'CAPTCHA validation failed.' });
});


app.post('/api/signup', authenticate,csrfProtection, validateSignup, handleValidationErrors, async (req, res) => {
    let { name, username,email, password, role} = req.body;
    const user = sanitize(req.user.username)
    
    const clientIp = ip.getClientIp(req);
    try {
        username = sanitize(username);
        const getUser = await User.findOne({ username:user })
        if (!name || !username || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            await logAction(getUser._id, getUser.username, 'add_user', 'failed', clientIp);
            return res.status(400).json({ message: 'Username already exists' });
        }
        const getRole = await Role.findOne({name: role});
        if (!getRole) {
            return res.status(400).json({ message: 'Invalid role provided' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            username,
            email,
            password: hashedPassword,
            role: getRole._id,
        });

        await newUser.save();
        await logAction(getUser._id, getUser.username, 'add_user', 'success', clientIp);
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Error during signup:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get('/api/getCameras', async (req, res) => {
    try {
        // Fetch all cameras from the database
        const cameras = await Camera.find();

        const message = JSON.stringify({ action: "TotalCamera" });
        vaPubsocket.send(message);
        console.log("Data send to VAZmq server for total camera................./////...........///////........")
        res.status(200).json({message: "Camera data fetched successfully", cameras});
    } catch (error) {
        console.error('Error fetching cameras:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.post('/api/addCamera', authenticate,csrfProtection, validateCamera, handleValidationErrors, async (req, res) => {
    const { streamid, streamname, primarystream, secondarystream, rtspstream, mediaStreamPrimary,mediaStreamSecondary, analytictype, status } = req.body;
    const user = sanitize(req.user.username); 
    const clientIp = req.ip;

    try {
        // Check if the authenticated user exists
        const getUser = await User.findOne({ username: user });
        if (!getUser) {
            return res.status(403).json({ message: 'Unauthorized action' });
        }

        // Check if all required fields are provided
        if (!streamid || !streamname || !primarystream || !secondarystream || !rtspstream || !mediaStreamPrimary || !mediaStreamSecondary || !analytictype) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Check for duplicate stream ID
        const existingCamera = await Camera.findOne({ streamid });
        if (existingCamera) {
            await logAction(getUser._id, getUser.username, 'add_camera', 'failed', clientIp);
            return res.status(400).json({ message: 'Stream ID already exists' });
        }

        const allCameras = await Camera.find();
        const currentCameraCount = allCameras.length;
        
        console.log(totalCameraToBeAdded,"...///......///..../////...//////..///")

        if (
            typeof totalCameraToBeAdded === "number" &&
            typeof totalAnalyticsToBeAdded === "number"
        ) {
            if (currentCameraCount + 1 > totalCameraToBeAdded) {
                return res.status(400).json({ message: `Camera limit exceeded. Max allowed: ${totalCameraToBeAdded}` });
            }

        }

        // Create a new camera document
        const newCamera = new Camera({
            streamid,
            streamname,
            primarystream,
            secondarystream,
            rtspstream,
            mediaStreamPrimary,
            mediaStreamSecondary,
            analytictype,
            status: status !== undefined ? status : true,
        });

        await newCamera.save();

        // Log success action
        await logAction(getUser._id, getUser.username, 'add_camera', 'success', clientIp);

        const message = {
            Topic: 'Add_Camera',
            id: newCamera._id.toString(),
            streamid,
            streamname,
            primarystream,
            secondarystream,
            rtspstream,
            analytictype,
            status,
        };
       
        const filePath ='/video-stream-app/public/streams.json';
        console.log(filePath,"fileContent");
        const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf8')); // Read the file
        fileContent.streams.push({
            streamid,
            streamname,
            primarystream,
            secondarystream,
            rtspstream,
            analytictype,
            status
        });
        fs.writeFileSync(filePath, JSON.stringify(fileContent,null, 2), 'utf8');

        const filePath1 = '/video-stream-app/build/streams.json';
        const fileContent1 = JSON.parse(fs.readFileSync(filePath1, 'utf8')); // Read the file
        fileContent1.streams.push({
            streamid,
            streamname,
            primarystream,
            secondarystream,
            rtspstream,
            analytictype,
            status
        });
        fs.writeFileSync(filePath1, JSON.stringify(fileContent1,null, 2), 'utf8');
 
        addToYML(streamid,mediaStreamPrimary,mediaStreamSecondary)

    res.status(201).json({ message: 'Camera added successfully', newCamera });
    } catch (error) {
        console.error('Error during add-camera operation:', error);

        if (req.user) {
            const getUser = await User.findOne({ username: user });
            if (getUser) {
                await logAction(getUser._id, getUser.username, 'add_camera', 'failed', clientIp);
            }
        }

        res.status(500).json({ message: 'Internal server error' });
    }
});

function addToYML(streamid,rtspLinkPrimary,rtspLinkSecondary){
    try {
        console.log(YAML_FILE_PATH,"filepath")
        let config = YAML.load(fs.readFileSync(YAML_FILE_PATH, 'utf8'));

        // Ensure the structure is there
        if (!config.paths) {
            config.paths = {};
        }

        // Add a new path for the stream
        config.paths[`primary${streamid}`] = {
            source: rtspLinkPrimary
        };
        config.paths[`secondary${streamid}`] = {
            source: rtspLinkSecondary
        };

        fs.writeFileSync(YAML_FILE_PATH, YAML.dump(config), 'utf8');
    } catch (yamlErr) {
        console.error('Error updating mediamtx.yml:', yamlErr);
        return res.status(500).json({ message: 'Camera added but failed to update media stream config' });
    }
}

// app.post("/api/addRoi", async (req, res) => {
//     try {
//         const {
//             dots,
//             lineDots,
//             cameraData,
//             direction,
//             entry_line_type,
//             exit_line_type,
//             crowd_formation_threshold,
//             crowd_formation_duration,
//             crowd_estimation_threshold,
//             crowd_estimation_duration,
//             loitering_threshold,
//             crowd_dispersion_threshold,
//             crowd_dispersion_duration
//         } = req.body;

//         if (!dots || !cameraData) {
//             return res.status(400).json({ error: "dots and cameraData are required" });
//         }

//         const {
//             streamid: id,
//             streamname: name,
//             rtspstream: url,
//             fps = 2,
//             username = "",
//             password = "",
//             analytictype: analytics
//         } = cameraData;

//         console.log(analytics, "analytics");

//         const existingCamera = await Camera.findOne({ streamid: id });

//         // Update analytic type in DB
//         await Camera.findOneAndUpdate(
//             { streamid: id },
//             {
//                 analytictype: analytics,
//                 polygon: dots,
//                 lines: lineDots,
//                 entry_line_type: entry_line_type,
//                 exit_line_type: exit_line_type,
//                 isUpdated: true,
//             },
//             { new: true }
//         );

//         const vaAnalytics = [];
//         let hasFaceRecognition = false;

//         // Construct VA analytics array
//         analytics.forEach(type => {
//             if (type === "face_recognition") {
//                 hasFaceRecognition = true;
//                 if (dots?.length) {
//                     vaAnalytics.push({
//                         type,
//                         roi: dots.map(([x, y]) => [x, y])
//                     });
//                 }
//             } else if (type === "person_in_out_count" && lineDots?.length >= 4) {
//                 const entry_line = [lineDots[0], lineDots[1]];
//                 const exit_line = [lineDots[2], lineDots[3]];

//                 vaAnalytics.push({
//                     type,
//                     entry_line,
//                     exit_line
//                 });
//             } else if (dots?.length) {
//                 vaAnalytics.push({
//                     type,
//                     roi: dots.map(([x, y]) => [x, y])
//                 });
//             }
//         });

//         // 1. Send face_recognition payload separately to FRS
//         if (hasFaceRecognition && dots?.length) {
//             const frsPayload = JSON.stringify({
//                 Topic: "Add_Camera",
//                 streamid: id,
//                 rtspstream: url,
//                 roi: dots.map(([x, y]) => [x, y])
//             });
//             await sendToZMQ(frsPayload, "frs");
//         }

//         // 2. Send full VA payload including face_recognition
//         if (vaAnalytics.length > 0) {
//             const vaPayload = JSON.stringify({
//                 action: existingCamera?.isUpdated ? "update_device" : "add_device",
//                 data: [{
//                     id,
//                     name,
//                     url,
//                     fps,
//                     username,
//                     password,
//                     entry_line_type,
//                     exit_line_type,
//                     direction,
//                     crowd_formation_threshold: parseInt(crowd_formation_threshold) || 0,
//                     crowd_formation_duration: parseInt(crowd_formation_duration) || 0,
//                     crowd_estimation_threshold: parseInt(crowd_estimation_threshold) || 0,
//                     crowd_estimation_duration: parseInt(crowd_estimation_duration) || 0,
//                     loitering_threshold: parseInt(loitering_threshold) || 0,
//                     crowd_dispersion_threshold: parseInt(crowd_dispersion_threshold) || 0,
//                     crowd_dispersion_duration: parseInt(crowd_dispersion_duration) || 0,
//                     analytics: vaAnalytics
//                 }]
//             });

//             console.log(vaPayload, "vaPayload");
//             await sendToZMQ(vaPayload, "va");
//         }

//         res.status(200).json({ message: "ROI added successfully" });

//     } catch (error) {
//         console.error("Error handling /addRoi:", error);
//         res.status(500).json({ error: "Failed to process ROI" });
//     }
// });


app.post("/api/addRoi", async (req, res) => {
    try {
        const {
            dots,
            lineDots,
            cameraData,
            direction,
            entry_line_type,
            exit_line_type,
            crowd_formation_threshold,
            crowd_formation_duration,
            crowd_estimation_threshold,
            crowd_estimation_duration,
            loitering_threshold,
            crowd_dispersion_threshold,
            crowd_dispersion_duration
        } = req.body;

        if (!dots || !cameraData) {
            return res.status(400).json({ error: "dots and cameraData are required" });
        }

        const {
            streamid: id,
            streamname: name,
            rtspstream: url,
            fps = 2,
            username = "",
            password = "",
            analytictype: analytics
        } = cameraData;

        console.log(analytics, "analytics");

        const allCameras = await Camera.find();
        const currentAnalyticsCount = allCameras.reduce((acc, cam) => acc + (cam.analytictype?.length || 0), 0);

        const newAnalyticsCount = analytics.length;
        if (currentAnalyticsCount + newAnalyticsCount > totalAnalyticsToBeAdded) {
            return res.status(400).json({ message: `Analytics limit exceeded. Max allowed: ${totalAnalyticsToBeAdded} including all the Cameras Analytics`});
        }
        
        const existingCamera = await Camera.findOne({ streamid: id });

        // Update analytic type in DB
        await Camera.findOneAndUpdate(
            { streamid: id },
            {
                analytictype: analytics,
                polygon: dots,
                lines: lineDots,
                entry_line_type: entry_line_type,
                exit_line_type: exit_line_type,
                isUpdated: true,
            },
            { new: true }
        );


        let zmqMessages = [];

        // Face recognition payload
        if (analytics.includes("face_recognition")) {
            const frsPayload = JSON.stringify({
                Topic:"Add_Camera",
                streamid : id,
                rtspstream : url,
               
                roi: dots.map(([x, y]) => [x, y])  // Corrected mapping
            });
            await sendToZMQ(frsPayload,"frs");
        }

        // Video analytics payload
        const vaAnalytics = [];

        analytics
            .filter(type => type !== "face_recognition")
            .forEach(type => {
                if (type === "person_in_out_count" && lineDots?.length) {
                    const entry_line = [lineDots[0], lineDots[1]];
    const exit_line = [lineDots[2], lineDots[3]];

    vaAnalytics.push({
        type,
        entry_line,
        exit_line
    });
                } else if (dots?.length) {
                    vaAnalytics.push({
                        type,
                        roi: dots.map(([x, y]) => [x, y])  // Corrected mapping
                    });
                }
            });

        if (vaAnalytics.length > 0) {
            const vaPayload = JSON.stringify({
            action:existingCamera.isUpdated ? "update_device" : "add_device",
            data:[{
                id,
                name,
                url,
                fps,
                username,
                password,
                entry_line_type,
                exit_line_type,
                direction:direction,
                crowd_formation_threshold: crowd_formation_threshold ? parseInt(crowd_formation_threshold) : 0,
                crowd_formation_duration: crowd_formation_duration ? parseInt(crowd_formation_duration) : 0,
                crowd_estimation_threshold: crowd_estimation_threshold ? parseInt(crowd_estimation_threshold) : 0,
                crowd_estimation_duration: crowd_estimation_duration ? parseInt(crowd_estimation_duration) : 0,
                loitering_threshold: loitering_threshold ? parseInt(loitering_threshold) : 0,
                crowd_dispersion_threshold: crowd_dispersion_threshold ? parseInt(crowd_dispersion_threshold) : 0,
                crowd_dispersion_duration: crowd_dispersion_duration ? parseInt(crowd_dispersion_duration) : 0,
                analytics: vaAnalytics,
            }],
            
            });

            console.log(vaPayload, "vaPayload");

           // zmqMessages.push({ payload: vaPayload, port: 5020 });
           await sendToZMQ(vaPayload,"va");
        }

        // Send messages to the respective ZMQ ports
       /*
        for (const { payload, port } of zmqMessages) {
            await sendToZMQ(payload, port);
            console.log(`Message sent to ZMQ port ${port}:`, payload);
        }
*/
        res.status(200).json({ message: "ROI added successfully" });

    } catch (error) {
        console.error("Error handling /addRoi:", error);
        res.status(500).json({ error: "Failed to process ROI" });
    }
});

app.post('/api/save-roi', async (req, res) => {
    const { image, roi } = req.body;

    if (!image || !roi || !Array.isArray(roi)) {
        return res.status(400).json({ error: 'Missing or invalid image/ROI data' });
    }
const base64Image = image.replace(/^data:image\/\w+;base64,/, '');
    // Convert ROI from object format to an array of arrays
    const formattedRoi = roi.map(point => [point.x, point.y]);

    // Prepare the payload
    const vaPayload = JSON.stringify({
        action: "attributes",
        data: [{
             image: base64Image,
            roi: formattedRoi
        }]
    });

    try {
        await sendToZMQ(vaPayload,"va");
        console.log(`Published ROI data to ZMQ: ${vaPayload}`);

        res.status(200).json({ message: 'ROI submitted successfully' });
    } catch (error) {
        console.error('ZMQ Error:', error);
        res.status(500).json({ error: 'Failed to publish ROI data' });
    }
});

async function sendToZMQ(message,string) {
    try {
        // Use the already connected vaPubsocket to send the message
        if(string == "va"){
        await vaPubsocket.send(message);   
        console.log(`Sent to VAZMQ:`, message,vaPubsocket);    
        }
        else{
         await pubSocket.send(message); 
         console.log(`Sent to ZMQ:`, message,pubSocket);
        }
    } catch (err) {
        console.error("Error sending to ZMQ:", err);
    }
}

const addAnalyticsData = async (type, analyticsList) => {
    try {
        if (!["FRS", "VA"].includes(type)) {
            throw new Error("Invalid analytics type. Allowed values: 'FRS', 'VA'");
        }

        let analyticsEntry = await Analytics.findOne({ type });

        if (analyticsEntry) {
            // If type exists, update the analytics array (add new items if not already present)
            analyticsEntry.analytics = [...new Set([...analyticsEntry.analytics, ...analyticsList])];
            await analyticsEntry.save();
            console.log(`Updated ${type} analytics:`, analyticsEntry);
        } else {
            // If type doesn't exist, create a new entry
            analyticsEntry = new Analytics({ type, analytics: analyticsList });
            await analyticsEntry.save();
            console.log(`Created new ${type} analytics:`, analyticsEntry);
        }
    } catch (error) {
        console.error("Error adding analytics data:", error.message);
    }
};

addAnalyticsData("FRS", ["face_recognition",]);

addAnalyticsData("VA",["intrusion","intrusion_with_attributes","loitering","crowd_formation","crowd_estimation","crowd_dispersion","fire_smoke_detection","person_in_out_count","person_waving_hand","fall_detection","wrong_direction","waiting_time_in_roi","Directional_arrow"]);


app.get("/api/getAnalytics", async (req, res) => {
    try {
        const analyticsData = await Analytics.find();
        
        const combinedAnalytics = [];

        analyticsData.forEach((item) => {
            combinedAnalytics.push(...item.analytics);
        });

        res.status(200).json({ analytics: combinedAnalytics });
    } catch (error) {
        console.error("Error fetching analytics:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.delete('/api/deleteCamera', authenticate, async (req, res) => {
    const user = sanitize(req.user.username); 
    const clientIp = req.ip;
    try {
        const getUser = await User.findOne({ username: user });
        if (!getUser) {
            return res.status(403).json({ message: 'Unauthorized action' });
        }
        const { streamid } = req.body;

        if (!streamid) {
            await logAction(getUser._id, getUser.username, 'delete_camera', 'failed', clientIp);
            return res.status(400).json({ message: 'Stream ID is required' });
        }

        // Find and delete the camera by streamid
        const deletedCamera = await Camera.findOneAndDelete({ streamid });

        if (!deletedCamera) {
            return res.status(404).json({ message: 'Camera not found' });
        }
        await logAction(getUser._id, getUser.username, 'delete_camera', 'success', clientIp);

        const message = {
            Topic: 'Delete_Camera',
            streamid,
        };
        const vaMessage = {
            action: 'delete_device',
            data:[{id: streamid}],
        };
        
        // Temp Code
        try {
          await pubSocket.send(JSON.stringify(message));
          console.log("data send to socket")
          await vaPubsocket.send(JSON.stringify(vaMessage));
          console.log("data send to vaSocket")
          //res.send({ message: 'Message sent successfully' });
        } catch (err) {
            console.error('Error sending message:', err);
            res.status(500).send({ message: 'Error sending message' });
        }   

          
        const filePath = '/video-stream-app/public/streams.json';
        const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf8')); 
        fileContent.streams = fileContent.streams.filter(camera => camera.streamid !== streamid); 
        fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), 'utf8');

        const filePath1 = '/video-stream-app/build/streams.json';
        const fileContent1 = JSON.parse(fs.readFileSync(filePath1, 'utf8'));
        fileContent1.streams = fileContent1.streams.filter(camera => camera.streamid !== streamid);
        fs.writeFileSync(filePath1, JSON.stringify(fileContent1, null, 2), 'utf8');
console.log("deleted")
        removeFromYAML(streamid)

        res.status(200).json({ message: 'Camera deleted successfully', deletedCamera });
    } catch (error) {
        console.error('Error deleting camera:', error);
        if (req.user) {
            const getUser = await User.findOne({ username: user });
            if (getUser) {
                await logAction(getUser._id, getUser.username, 'delete_camera', 'failed', clientIp);
            }
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

function removeFromYAML(streamid){
    try {
        let config = YAML.load(fs.readFileSync(YAML_FILE_PATH, 'utf8'));
        const id1 = `primary${streamid}`;
        const id2 = `secondary${streamid}`;

        if (config.paths && config.paths[id1]) {
            delete config.paths[id1];

            fs.writeFileSync(YAML_FILE_PATH, YAML.dump(config), 'utf8');
            console.log(`Stream '${id1}' removed from mediamtx.yml`);
        } else {
            console.warn(`Stream '${id1}' not found in mediamtx.yml`);
        }

        if (config.paths && config.paths[id2]) {
            delete config.paths[id2];

            fs.writeFileSync(YAML_FILE_PATH, YAML.dump(config), 'utf8');
            console.log(`Stream '${id2}' removed from mediamtx.yml`);
        } else {
            console.warn(`Stream '${id2}' not found in mediamtx.yml`);
        }
    } catch (error) {
        console.error('Error updating mediamtx.yml:', error);
        throw new Error('Failed to update MediaMTX config');
    }
}


app.get('/api/getUsers', async (req, res) => {
    try {
        const users = await User.find({ username: { $ne: "admin@admin.com" } }, { password: 0 })
            .populate('role', 'name rights');  // Populate role with name and rights
        //console.log(users,"users")
        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching users:', error.message);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.delete('/api/deleteUser', async (req, res) => {
    let { username } = req.body;
    username = sanitize(username);
    try {
        const result = await User.findOneAndDelete({ username });
        if (!result) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error.message);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/api/getToken',csrfProtection,(req,res) => {
    const csrfToken = req.csrfToken();
    //console.log(csrfToken,"csrfToken");
    res.setHeader('X-CSRF-Token',csrfToken);
    res.status(200).json({message:"Successfully send the token"})
})

app.get('/api/login',csrfProtection, (req, res) => {
    const csrfToken = req.csrfToken();
    res.setHeader('X-CSRF-Token', csrfToken);
    res.status(200).json({ message: 'Login Page' })
});


app.post('/api/login',csrfProtection, validateLogin,verifyLicenseFile, handleValidationErrors, async (req, res) => {
    let { username, password, userCaptcha } = req.body;
    //console.log(req.body,"dd")
    try {
         if (userCaptcha !== captchaText) {
           return res.status(400).json({ message: 'Invalid CAPTCHA. Please try again.' });
         }
        const clientIp = req.ip
        const secretKey = "IZOia7Nvb3UTYdV+s8SOw0fA1qiecbEvgbFVmjdxFrvhEotmFdCa4U2tmX38WKPU";
        username = decrypt(username, secretKey);
        //username = sanitize(username);
        password = decrypt(password, secretKey);

        const user = await User.findOne({ username }).populate('role');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const lastAttempt = await LoginAttempts.findOne({ username }).sort({ timestamp: -1 });

        if (lastAttempt && lastAttempt.blocked_time) {
            const now = Date.now();
            const blockEndTime = new Date(lastAttempt.blocked_time).getTime();
            if (now < blockEndTime) {
                const remainingTime = Math.ceil((blockEndTime - now) / 60000);
                await logAction(user._id, username, 'login', 'failed', clientIp);
                return res.status(403).json({
                    message: `Maximum login attempts reached. Try again after ${remainingTime} minute(s).`,
                });
            } else {
                await LoginAttempts.deleteMany({ username });
            }
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log(isPasswordValid,"valid?",password,"  ",user.password);
        if (!isPasswordValid) {
            const failedAttempts = await handleFailedLogin(user._id, username, clientIp);

            const { blocked, remainingTime } = await isBlocked(failedAttempts);
            if (blocked) {
                return res.status(429).json({
                    message: `Maximum login attempts reached. Try again after ${remainingTime} minute(s).`,
                });
            }
            await logAction(user._id, username, 'login', 'failed', clientIp);
            return res.status(401).json({ message: 'Invalid password' });
        }

        await clearFailedAttempts(user._id, username);
        await logAction(user._id, username, 'login', 'success', clientIp);
        const userRights = user.role.rights.reduce((rightsObj, right) => {
            rightsObj[right.name] = right.enabled;
            return rightsObj;
        }, {});
        
        const SESSION_EXPIRY = 86400000
        const sessionId = `${Date.now()}-${Math.random()}`;
        const session = new Session({
          sessionId,
          userId: user._id,
          expiresAt: new Date(Date.now() + SESSION_EXPIRY),
        });
        await session.save();
        console.log("sessionid",session,sessionId)
        const token = jwt.sign({ username, role: user.role.name, rights: userRights,sessionId}, process.env.JWT_SECRET,{ expiresIn: SESSION_EXPIRY });
        req.session.authToken = token;
        res.status(200).json({ message: 'Login successfully',sessionId });
    } catch (error) {
        console.error('Error during login:', error);
        const user = await User.findOne({ username }).populate('role');
        await logAction(user._id, username, 'login', 'failed', clientIp);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/uploadFace', authenticate, validateAddFace, async (req, res) => {
    const {
        isMultiple,
        isSinglePerson,
        compressedFolder,
        PersonName,
        Image,
        Remark,
        Type,
        GroupName,
        Age,
        Sex,
        enhanceFace
    } = req.body;

    const username = req.user.username;
    const clientIp = ip.getClientIp(req);

    let message;

    if (isMultiple) {
        if (isSinglePerson) {
            // Multi-image, but same person — include person details
            message = JSON.stringify({
                isMultiple: true,
                isSinglePerson: true,
                path: compressedFolder,
                PersonName: PersonName,
                Age: Age,
                Sex: Sex,
                Remark: Remark || "Default Remark",
                Type: Type,
                GroupName: GroupName || "Default Group",
                Topic: "SinglePerson"
            });
        } else {
            // Batch of people — just send the folder
            message = JSON.stringify({
                isMultiple: true,
                path: compressedFolder,
                Remark: Remark || "Default Remark",
                Type: Type,
                GroupName: GroupName || "Default Group",
                Topic: "MultipleFaces"
            });
        }
    } else {
        // Single image upload
        message = JSON.stringify({
            isMultiple: false,
            PersonName: PersonName,
            Image: Image,
            Age: Age,
            Sex: Sex,
            Remark: Remark || "Default Remark",
            Type: Type,
            GroupName: GroupName || "Default Group",
            Topic: "New Face",
            enhanceFace:enhanceFace
        });
    }

    try {
        pubSocket.send(message); // Send data to ZeroMQ
        console.log("Message sent to server:", message);

        const user = await User.findOne({ username });
        await logAction(user._id, user.username, 'upload_face', 'success', clientIp);

        res.status(201).send({ message: 'Data sent to server' });
    } catch (err) {
        console.error("Error sending data:", err);
        res.status(500).send({ message: 'Error sending data to server' });
    }
});


app.post('/api/getPersonsData', authenticate, async(req, res) => {
   const { fromDate, toDate,findPersonName} = req.body;
    const data = JSON.stringify({
        Topic:"Table Data",
        fromDate,
        toDate,
        findPersonName
    })
    try {
        await pubSocket.send(data)
        res.status(201).send({ message: 'Data sent to server via ZeroMQ!' });
        
    } catch (err) {
        res.status(500).send({ message: "Error in sending request" });
    }
});


app.post('/api/delete',authenticate, async(req, res) => {
    let { id,name } = req.body;
    const username = sanitize(req.user.username);
    const clientIp = ip.getClientIp(req);
    id = sanitize(id);
    try {
        pubSocket.send(JSON.stringify({ Topic: "delete", id, name }));

        console.log("Delete request sent successfully");
        const user = await User.findOne({ username })
        await logAction(user._id, user.username, 'delete_face', 'success', clientIp);
        res.json({ message: 'Request to delete object sent to server' });

    } catch (error) {
        console.error("Error occurred while sending data to server:", error);
        const user = await User.findOne({ username })
        await logAction(user._id, user.username, 'delete_face', 'failed', clientIp);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.post('/api/getDetectFacesReport', authenticate, async (req, res) => {
    const {
        fromDate,
        toDate,
        personName,
        gender,
        glasses,
        beard,
        ageFrom,
        ageTo,
        page = 1
    } = req.body;

    const itemsPerPage = 50;
    const skipRecords = Math.max(0, (page - 1) * itemsPerPage);

    try {
        let query = {
            Event: "FaceDetected"
        };

        // Date range filter
        if (fromDate && toDate) {
            query.Timestamp = {
                $gte: new Date(fromDate),
                $lte: new Date(toDate)
            };
        }

        // Name filter
        if (personName) {
            query.Name = { $regex: personName, $options: 'i' };
        }

        // Build nested $elemMatch filter dynamically only if needed
        const attributesFilter = {};

        if (gender) {
            attributesFilter["attributes.Gender"] = gender;
        }

        if (glasses) {
            attributesFilter["attributes.Glasses"] = glasses;
        }

        if (beard) {
            attributesFilter["attributes.Beard"] = beard;
        }

        if (ageFrom !== undefined && ageTo !== undefined) {
            attributesFilter["attributes.Age"] = {
                $gte: parseInt(ageFrom),
                $lte: parseInt(ageTo)
            };
        }

        if (Object.keys(attributesFilter).length > 0) {
            query.Parameters = {
                $elemMatch: {
                    type: "person",
                    ...attributesFilter
                }
            };
        }

        console.log("Final MongoDB Query:", JSON.stringify(query, null, 2));

        const totalRecords = await Event.countDocuments(query);

        const records = await Event.find(query)
            .sort({ Timestamp: -1 })
            .skip(skipRecords)
            .limit(itemsPerPage)
            .lean();

        return res.json({ totalRecords, records });

    } catch (error) {
        console.error("Error occurred", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


app.post('/api/getVaDetectFacesReport', authenticate, async (req, res) => {
    const { eventType, formattedFromDate, formattedToDate, page, color, gender, entityType, age, view, bag, sleeves, upperBody, lowerBody } = req.body;
    console.log(req.body, "Request Body");

    const itemsPerPage = 50;
    const skipRecords = Math.max(0, (page - 1) * itemsPerPage);

    try {
        //  Build Dynamic Query
        let query = {};

        // 🔹 Event Type Filter (Single Value)
        if (eventType) {
    query.Event = eventType;
} else {
    // Exclude Face_Detected by default if no specific eventType filter is applied
    query.Event = { $ne: "FaceDetected" };
}

        // 🔹 Date Range Filter (Ensure Dates are Properly Parsed)
        if (formattedFromDate && formattedToDate) {
            query.Timestamp = { 
                $gte: new Date(formattedFromDate), 
                $lte: new Date(formattedToDate) 
            };
        }

        // 🔹 Attributes Filtering (Entity Type, Color, Gender)
        if ((entityType && entityType.length) || color || gender || age || view || bag || sleeves || upperBody || lowerBody) {
  query.Parameters = { $elemMatch: {} };

  const vehicleTypes = ["truck", "car", "bike"];
  let finalEntityTypes = [];

  if (Array.isArray(entityType)) {
    finalEntityTypes = entityType.flatMap((type) => {
      if (type === "vehicle") {
        return vehicleTypes;
      }
      return type;
    });
  }

  if (finalEntityTypes.length > 0) {
    query.Parameters.$elemMatch["type"] = { $in: finalEntityTypes };
  }

  if (color) {
    query.Parameters.$elemMatch["attributes.color"] = color;
  }

  if (gender) {
    query.Parameters.$elemMatch["attributes.Gender"] = gender;
  }

  if (age) {
    query.Parameters.$elemMatch["attributes.Age"] = age;
  }

  if (view) {
    query.Parameters.$elemMatch["attributes.View"] = view;
  }

  if (bag) {
    query.Parameters.$elemMatch["attributes.Bag"] = bag;
  }

  if (sleeves) {
    query.Parameters.$elemMatch["attributes.Sleeves"] = sleeves;
  }

  if (upperBody) {
    query.Parameters.$elemMatch["attributes.UpperBody"] = upperBody;
  }

  if (lowerBody) {
    query.Parameters.$elemMatch["attributes.LowerBody"] = lowerBody;
  }
}

        //  Get Total Record Count
        const totalRecords = await Event.countDocuments(query);

        // Fetch Paginated Data (Latest First)
        const detectedFaces = await Event.find(query)
            .sort({ Timestamp: -1 })
            .skip(skipRecords)
            .limit(itemsPerPage)
            .lean(); 

        // Send Response
        res.json({message: 'Data fetched successfully', totalRecords, records: detectedFaces });

    } catch (err) {
        console.error('Error fetching data:', err);
        res.status(500).send({ message: 'Error fetching VA detection data' });
    }
});

  
app.get('/api/images/*', (req, res) => {
    let originalPath = req.params[0]; // e.g., "app/virtual_analytics/..."
    console.log('Received image path:', originalPath);
  
    originalPath = originalPath.replace(/\\/g, '/');
  
    // Make sure the path starts with "app/" to avoid abuse
    if (!originalPath.startsWith('app/')) {
      if (!res.headersSent) res.status(400).send('Invalid path');
      return;
    }
  
    // Remove the "app/" part, as it's already the container path root
    const relativePath = originalPath.replace(/^app\//, '');
    const filePath = path.join('/app', relativePath);  // Final absolute path inside Docker
  
    console.log('Resolved file path:', filePath);
  
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('File not found:', err.message);
        if (!res.headersSent) {
          res.status(404).send('File not found');
        }
      }
    });
  });


app.get('/api/roles', authenticate, async (req, res) => {
    try {
        const roles = await Role.find({ name: { $ne: 'SuperAdmin' } });
        res.status(200).json(roles);
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/roles', authenticate,csrfProtection, validateRole, async (req, res) => {
    try {
        let { name, rights } = req.body;
         name = sanitize(name);
        // Validate required fields
        if (!name || !rights || !Array.isArray(rights)) {
            return res.status(400).json({ message: 'Role name and rights are required.' });
        }

        // Check if the role already exists
        const existingRole = await Role.findOne({ name });
        if (existingRole) {
            return res.status(400).json({ message: 'Role with this name already exists.' });
        }

        // Create a new role
        const newRole = new Role({
            name,
            rights,
        });

        // Save to the database
        const savedRole = await newRole.save();
        res.status(201).json({ message: 'Role created successfully', role: savedRole });
    } catch (error) {
        console.error('Error creating role:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.put('/api/roles/update-rights', authenticate,csrfProtection, async (req, res) => {
console.log("roles")
    const { roles } = req.body;

    try {
        if (!roles || !Array.isArray(roles)) {
            return res.status(400).json({ message: 'Invalid data format. Expected an array of roles.' });
        }

        const updatedRoles = await Promise.all(
            roles.map(async (role) => {
                const { id, rights } = role;

                // Transform rights into the correct format
                const formattedRights = rights.map((right) => {
                    if (typeof right === 'string') {
                        return { name: right, enabled: true };
                    }
                    return right;
                });

                // Update the role in the database
                return await Role.findByIdAndUpdate(
                    id,
                    { rights: formattedRights },
                    { new: true }
                );
            })
        );

        res.status(200).json({
            message: 'Roles updated successfully',
            updatedRoles,
        });
    } catch (error) {
        console.error('Error updating roles:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get('/api/validate', authenticate, (req, res) => {
    res.status(200).json({ message: 'User Identified', user: req.user });
});


app.post('/api/logs', async (req, res) => {
    try {
        const { page, itemsPerPage } = req.body;

        const pageNumber = page > 0 ? page : 1;
        const limit = itemsPerPage > 0 ? itemsPerPage : 50;
        const skip = (pageNumber - 1) * limit;

        // Fetch logs with pagination and populate user_id with username
        const logs = await UserLogs.find()
            .populate('user_id', 'name') // Fetch only the 'username' field from the User collection
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        const totalCount = await UserLogs.countDocuments();

        res.json({ logs, totalCount });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ message: 'Error fetching logs' });
    }
});


const otpStore = new Map();

async function getEmailConfig() {
    //console.log(enailConfig,"emailConfig")
    const config = await emailConfig.findOne();
    if (!config) {
        throw new Error('Email configuration not found in the database.');
    }
    //config.password = decryptPassword(config.password);
    return config;
}

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const config = await getEmailConfig();
        // Generate a random 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000);
        
        // Store the OTP and its expiry in the database (optional)
        // Example: Save to your `users` or `password_reset` collection
         const user = await User.findOne({ email });
         if (!user) {
             return res.status(400).json({ message: 'Email not registered' });
         }
         //user.resetOtp = otp;
         //user.resetOtpExpires = Date.now() + 10 * 60 * 1000;
         //await user.save();

        // Configure NodeMailer
        const transporter = nodemailer.createTransport({
            host: config.host, 
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.username, // Your email
                pass: config.password, // Your Gmail app password
            },
        });

        // Email content
        const mailOptions = {
            from: '"Sparsh Support"<email@gmail.com>',
            to: email,
            subject: 'Requested Password Reset OTP',
            html: `
                <p>Your OTP for password reset is: <b>${otp}</b></p>
                <p>If you didn't request this, you can ignore this email.</p>
            `,
        };

        // Send the email
        await transporter.sendMail(mailOptions);
        otpStore[email] = otp;
        res.json({ message: 'If the email is registered, an OTP has been sent.' });
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ message: 'An error occurred. Please try again later.' });
    }
});


// Route to validate OTP
app.post('/api/validate-otp', (req, res) => {
    const { email, otp } = req.body;
    
//console.log(otpStore)
    const storedOtp = otpStore[email];
    //console.log(storedOtp,email,otp)
    if (!storedOtp) {
        return res.status(400).json({ message: "OTP has expired or is invalid." });
    }

    if (storedOtp != otp) {
        return res.status(400).json({ message: "Invalid OTP." });
    }

    otpStore.delete(email); // Remove OTP after successful validation
    res.status(200).json({ message: "OTP verified successfully." });
});

// Route to reset password
app.post('/api/reset-password', async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(404).json({ message: "User not found." });
    }

    user.password = await bcrypt.hash(password, 10); // Hash new password
    await user.save();
    await logAction(user._id, user.username, 'reset-password', 'success', clientIp);

    res.status(200).json({ message: "Password reset successfully." });
});


app.post('/api/logout', authenticate, async(req, res) => {
    const username = sanitize(req.user.username);
    const clientIp = ip.getClientIp(req);
    // const sessionId = req.headers['authorization']?.replace('Session ', '');
    // console.log(req.user,sessionId,"user")
    const sessionId = req.user.sessionId
    try {
        const user = await User.findOne({ username })
        await logAction(user._id, user.username, 'logout', 'success', clientIp);
        // console.log(req.user.sessionId,"sessionId")
        //await Session.deleteOne({ sessionId: req.user.sessionId });
        const result = await Session.deleteOne({ sessionId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Session not found' });
        }
        res.clearCookie('connect.sid', { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
        //res.status(200).json({ message: 'Logout successful, session deleted' });
        res.status(200).json({message: 'Logged out successfully' });
    } catch (error) {
        const user = await User.findOne({ username })
        res.clearCookie('connect.sid', { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
        await logAction(user._id, user.username, 'logout', 'failed', clientIp);
        res.status(500).json({ message: `Server error ${error}`});
    }
    
});


app.listen(process.env.PORT,process.env.HOST,()=>{
    console.log("Server is running on Port",process.env.HOST, process.env.PORT)
});


