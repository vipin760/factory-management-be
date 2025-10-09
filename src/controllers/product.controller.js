const catchAsync = require("../middleware/catchAsyncErrors");
const productServices = require("../services/product.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createproduct = catchAsync(async (req, res, next) => {
    const { status, data, message } = await productServices.createProductService(req.body, req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.fetchproduct = catchAsync(async (req, res, next) => {
    const { status, data, message } = await productServices.getAllProductsService(req.query);
    if (!status) return next(new ErrorHandler(message, 400));
    const { result, total, page } = data
    return res.status(200).send({ status, result, total, page, message })
})

exports.deleteproduct = catchAsync(async (req, res, next) => {
    const { status, data, message } = await productServices.deleteProductService(req.params.id,req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})

exports.updateproduct = catchAsync(async (req, res, next) => {
    const { status, data, message } = await productServices.updateProductService(req.params.id, req.body,req.user.id);
    if (!status) return next(new ErrorHandler(message, 400));
    return res.status(200).send({ status, data, message })
})