const catchAsync = require("../middleware/catchAsyncErrors");
const unitMasterServices = require("../services/unit.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createUnitMaster = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await unitMasterServices.createUnitMaster(req.user.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getAllUnitMaster = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await unitMasterServices.getUnitMaster(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.deleteUnitMaster = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await unitMasterServices.deleteUnitMaster(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.updateUnitMaster = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await unitMasterServices.updateUnitMaster(req.params.id,req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
     const { response,total,page,limit} =  data
    return res.status(200).send({status,data:response,total,page,limit,message})
})