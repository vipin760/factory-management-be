const catchAsync = require("../middleware/catchAsyncErrors");
const transitRegisterServices = require("../services/transitRegister.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createtransitRegister = catchAsync(async (req, res, next) => {
    const { status, data, message } = await transitRegisterServices.createTransitRegisterService(req.body);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.fetchtransitRegister = catchAsync(async (req, res, next) => {
    const { status, data, message } = await transitRegisterServices.getAllTransitRegisterService(req.query);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.updatetransitRegister = catchAsync(async (req, res, next) => {
    const { status, data, message } = await transitRegisterServices.updateTransitRegisterService(req.params.id, req.body);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.deletetransitRegister = catchAsync(async (req, res, next) => {
    const { status, data, message } = await transitRegisterServices.deleteTransitRegisterService(req.params.id,req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.fetchtransitRegisterById = catchAsync(async (req, res, next) => {
    const { status, data, message } = await transitRegisterServices.getTransitRegisterServiceById(req.params.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status,data, message })
})