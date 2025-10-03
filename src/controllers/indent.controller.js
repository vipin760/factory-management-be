const catchAsync = require("../middleware/catchAsyncErrors");
const indentServices = require("../services/indent.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createIndent = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await indentServices.createIndentService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getAllIndent = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await indentServices.getAllIndentService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getByIndentId = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await indentServices.getIndentByIdService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.deleteIndent = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await indentServices.deleteIndentService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.updateIndent = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await indentServices.updateIndentService(req.body,req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})


