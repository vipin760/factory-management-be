const catchAsync = require("../middleware/catchAsyncErrors");
const dashboardServices = require("../services/dashboard.service");
const ErrorHandler = require("../utils/errorHandler");

exports.fetchdashboard = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await dashboardServices.getDashboardData(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.fetchdashboardRecentActivity = catchAsync( async(req ,res ,next)=>{
    const { status,message,data,pagination } = await dashboardServices.fetchRecentActivity(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,pagination,message})
})

exports.fetchPendingApprovalController= catchAsync( async(req ,res ,next)=>{
    const { status,message,data,pagination } = await dashboardServices.fetchPendingApprovalService(req.query);
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,pagination,message})
})