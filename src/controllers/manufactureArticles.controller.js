const catchAsync = require("../middleware/catchAsyncErrors");
const manufactureArticleServices = require("../services/manufactureArticles.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createmanufactureArticle = catchAsync(async (req, res, next) => {
    const { status, data, message } = await manufactureArticleServices.createManufactureArticleService(req.body, req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.fetchmanufactureArticle = catchAsync(async (req, res, next) => {
    const { status, data, message } = await manufactureArticleServices.getAllManufactureArticleService(req.query);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.deletemanufactureArticle = catchAsync(async (req, res, next) => {
    const { status, data, message } = await manufactureArticleServices.deleteManufactureArticleService(req.params.id,req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.updatemanufactureArticle = catchAsync(async (req, res, next) => {
    const { status, data, message } = await manufactureArticleServices.updateManufactureArticleService(req.params.id, req.body,req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.fetchmanufactureArticleById = catchAsync(async (req, res, next) => {
    const { status, data, message } = await manufactureArticleServices.getManufactureArticleServiceById(req.params.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status,data, message })
})