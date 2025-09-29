const catchAsync = require("../middleware/catchAsyncErrors");
const grnServices = require("../services/grns.services");
const ErrorHandler = require("../utils/errorHandler");

exports.creategrn = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await grnServices.createGrnService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getAllgrn = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await grnServices.getAllGrnService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.deletegrn = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await grnServices.deleteGrnService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.updategrn = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await grnServices.updateGrnService(req.params.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})