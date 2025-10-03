const catchAsync = require("../middleware/catchAsyncErrors");
const reportsServices = require("../services/reports.services");
const ErrorHandler = require("../utils/errorHandler");

exports.createReports = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await reportsServices.getProductExpenditureService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.getMonthlyExpensesReport = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} = await reportsServices.getMonthlyExpensesReportService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

