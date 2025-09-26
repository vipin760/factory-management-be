const authServices = require("../services/auth.services")
const catchAsync = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/errorHandler");

exports.RegisterUser = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} =await authServices.registerUserService(req.body)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.loginUser = catchAsync( async(req,res,next)=>{
    const {status, data, message} = await authServices.loginUserService(req.body)
    if(!status) return next(new ErrorHandler(message,400));
    const {role,email,name,token} = data
    const user = {role,email,name}
    return res.status(200).send({status,data:token,user,message})
})