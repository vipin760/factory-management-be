const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = 'uploads/';
const imageDir = path.join(uploadDir, 'images');
const docsDir = path.join(uploadDir, 'docs');

// Create directories if not exist
[uploadDir, imageDir, docsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const isImage = file.mimetype.startsWith('image/');
        cb(null, isImage ? imageDir : docsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.test(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only images or docs are allowed'));
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

module.exports = upload;
