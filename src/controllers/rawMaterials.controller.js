const catchAsync = require("../middleware/catchAsyncErrors");
const rawMaterialServices = require("../services/rawMaterials.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createRawMaterial = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await rawMaterialServices.createRawMaterialService(req.body)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchRawMaterial = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await rawMaterialServices.fetchRawMaterialService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
   const { response, total, page, limit } = data
    return res.status(200).send({status,data:response,total,limit,page,message})
})

exports.deleteRawMaterial = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await rawMaterialServices.deleteRawMaterialService(req.params.id)
    if(!status) return next(new ErrorHandler(message,400));
   const { response, total, page, limit } = data
    return res.status(200).send({status,data:response,total,limit,page,message})
})

exports.updateRawMaterial = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await rawMaterialServices.updateRawMaterialService(req.params.id,req.body)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})