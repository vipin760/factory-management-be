const catchAsync = require("../middleware/catchAsyncErrors");
const purchaseServices = require("../services/purchase.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createPurchase = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await purchaseServices.createNewPurchaseOrderService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchPurchase = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await purchaseServices.getAllPurchaseOrderService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
   const { purchases,total,page,limit } = data
    return res.status(200).send({status,data:purchases,total,page,limit,message})
})

exports.deletePurchase = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await purchaseServices.deletePurchaseOrderService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
   const { purchases,total,page,limit } = data
    return res.status(200).send({status,data:purchases,total,page,limit,message})
})

exports.updatePurchase = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await purchaseServices.updatePurchaseOrderService(req.params.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})