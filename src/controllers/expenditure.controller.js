const expenditureServices = require("../services/expenditure.services")
const catchAsync = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/errorHandler");

exports.fetchExpenditure = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} =await expenditureServices.getMonthlyExpensesReportService(req.body)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})
