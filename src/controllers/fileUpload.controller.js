const fileUploadServices = require("../services/fileUpload.service")
const catchAsync = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/errorHandler");

exports.fileUploadControllerFun = catchAsync(async (req, res, next) => {
    const { status, data, message } = await fileUploadServices.fileUploadService(
        req.body, 
        req.user.id, 
        req.files
    );

    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message });
});

exports.deleteFileController = async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const userId = req.user?.id || 1; 

        const result = await fileUploadServices.deleteFileService(fileId, userId);
        if (!result.status) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
};

exports.fetchFileController = async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const result = await fileUploadServices.getAllFilesService();
        if (!result.status) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
};