const catchAsync = require("../middleware/catchAsyncErrors");
const userServices = require("../services/user.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createuser = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await userServices.createUserService(req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getAlluser = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await userServices.getAllUsersService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.deleteuser = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await userServices.deleteUserService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getAlluserById = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await userServices.getUserByIdService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.updateuser = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await userServices.updateUserService(req.params.id,req.body,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
     const { response,total,page,limit} =  data
    return res.status(200).send({status,data:response,total,page,limit,message})
})