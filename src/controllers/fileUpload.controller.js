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