const catchAsync = require("../middleware/catchAsyncErrors");
const vendorServices = require("../services/vendor.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createvendor = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await vendorServices.createVendorService(req.body);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchVendor = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await vendorServices.getAllVendorService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    const {  vendors,total,page,limit} = data
    return res.status(200).send({status,data:vendors,total,page,limit,message})
})

exports.updateVendor = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await vendorServices.updateVendorService(req.params.id,req.body);
    if(!status) return next(new ErrorHandler(message,400));
    const {  vendors,total,page,limit} = data
    return res.status(200).send({status,data:vendors,total,page,limit,message})
})

exports.deleteVendor = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await vendorServices.deleteVendorService(req.params.id);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})