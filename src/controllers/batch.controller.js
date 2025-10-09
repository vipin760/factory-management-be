const catchAsync = require("../middleware/catchAsyncErrors");
const batchServices = require("../services/batch.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createbatch = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await batchServices.createBatchService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getAllbatch = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await batchServices.getAllBatchService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
     const {total, page,totalPages, result } = data
    return res.status(200).send({status,data:result,page,total,totalPages,message})
})

exports.deletebatch = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await batchServices.deleteBatchService(req.params.id,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.updatebatch = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await batchServices.updateBatchService(req.params.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})