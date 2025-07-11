const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Hash = require('./models/FileHash')

const foldersToMonitor = [
'/video-stream-app/src',
'/video-stream-app/src/components',
];

const generateFileHash = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  return hash;
};

// Function to Initialize Hashes for All Files in Specified Folders
const initializeHashesForFolders = async (folders) => {
  console.log("Folders to hash:", folders);

  for (const folderPath of folders) {
      try {
          console.log(`Hashing files in folder: ${folderPath}`);
          const files = fs.readdirSync(folderPath);

          for (const file of files) {
              const filePath = path.resolve(folderPath, file);

              // Only process files (skip subfolders)
              if (fs.lstatSync(filePath).isFile()) {
                  const hash = generateFileHash(filePath);
                  // Upsert: Create or update the hash record
                  await Hash.findOneAndUpdate(
                      { filePath }, // Match on filePath
                      { fileName: file, filePath, hash }, // Data to update
                      { upsert: true, new: true } // Create new if not found
                  );
              }
          }
      } catch (error) {
          console.error(`Error processing folder: ${folderPath}`, error);
      }
  }
  console.log("Initial hashing completed for all folders.");
};

// Function to Verify File Integrity Across Specified Folders
const verifyFileIntegrityForFolders = async () => {
    try {
        console.log("Starting file integrity verification...");
        const storedHashes = await Hash.find(); // Retrieve all stored hashes

        for (const folderPath of foldersToMonitor) {
            console.log(`Verifying files in folder: ${folderPath}`);
            for (const fileRecord of storedHashes) {
                    const { filePath, hash: storedHash, fileName } = fileRecord;
                    // Skip files not in the current folder
                    const relativePath = path.relative(folderPath, filePath);
                    if (relativePath.includes(path.sep) || relativePath.startsWith('..')) continue;

                    if (!fs.existsSync(filePath)) {
                        console.log(`File missing: ${filePath}`);
                        continue;
                    }

                    const currentHash = generateFileHash(filePath);

                    if (currentHash !== storedHash) {
                        console.log(`File tampered: ${fileName}`);
                        throw new Error(`File tampered: ${fileName}`);
                    } 
                }
        }
        console.log("File integrity verification completed.");
        //next();
    } 
    catch (error) {
        console.error('Error during file integrity verification:', error);
        throw new Error('File integrity verification failed');
    }
};

const verifyLicenseFile = (req, res, next) => {
    const licenseFilePath = path.join(__dirname, "license.bin");
    console.log(licenseFilePath,__dirname,"licenseFilePath")
    console.log(`Checking for license file at: ${licenseFilePath}`);

    if (!fs.existsSync(licenseFilePath)) {
        console.error("Critical file missing: license.bin");
        return res.status(403).json({ message: "Required license is missing." });
    }

    console.log("License file found.");   
    next(); 
};


// Export Functions
module.exports = {
  initializeHashesForFolders,
  verifyFileIntegrityForFolders,
  verifyLicenseFile,
};

