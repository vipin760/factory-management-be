const catchAsync = require("../middleware/catchAsyncErrors");
const productionServices = require("../services/production.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.createProductionService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.getAllproductionOrderService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
   const { productions,total,page,limit } = data
    return res.status(200).send({status,data:productions,total,page,limit,message})
})

exports.deleteproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.deleteproductionOrderService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
   const { productions,total,page,limit } = data
    return res.status(200).send({status,data:productions,total,page,limit,message})
})

exports.updateproduction = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await productionServices.updateproductionOrderService(req.params.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})