const express = require('express');
const routes = express();
const fileUploadController = require('../controllers/fileUpload.controller');
const { authenticate } = require('../middleware/auth');
const upload = require('../utils/fileUpload'); // your custom multer instance

routes.use(authenticate);

// Use your custom multer instance with .fields()
routes.post(
  '/',
  upload.fields([
    { name: 'files', maxCount: 10 },  // multiple files
    { name: 'pro_pic', maxCount: 1 }  // single profile picture
  ]),
  fileUploadController.fileUploadControllerFun
);
routes.get('/', fileUploadController.fetchFileController);
routes.delete('/:fileId', fileUploadController.deleteFileController);

module.exports = routes;
