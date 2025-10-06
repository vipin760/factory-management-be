const catchAsync = require("../middleware/catchAsyncErrors");
const productionServices = require("../services/production.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.createProductionService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.getAllProductionService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
   const { result,total,page,limit } = data
    return res.status(200).send({status,data:result,total,page,limit,message})
})

exports.fetchBatchesName = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.productionBatchNamesOnly(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.deleteproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.deleteProductionService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,message})
})

exports.updateproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.updateProductionService(req.params.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})