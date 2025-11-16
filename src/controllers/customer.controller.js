const catchAsync = require("../middleware/catchAsyncErrors");
const customerOrderServices = require("../services/customer.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createCustomerOrders = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await customerOrderServices.createCustomerOrders(req.body,req.user.id)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.deleteCustomerOrders = catchAsync( async(req ,res ,next)=>{
    const { status,message,data } = await customerOrderServices.deleteCustomerOrder(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchCustomerOrders= catchAsync( async(req ,res ,next)=>{
    const { status,message,data,pagination } = await customerOrderServices.getCustomerOrders(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,pagination,message})
})

exports.updateCustomerOrders= catchAsync( async(req ,res ,next)=>{
    const { status,message,data } = await customerOrderServices.updateCustomerOrder(req.body,req.params.id,req.user.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})