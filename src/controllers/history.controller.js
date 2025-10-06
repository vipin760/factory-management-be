const historyServices = require("../services/history.serices")
const catchAsync = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/errorHandler");

exports.getAllHistory = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} =await historyServices.getAllPurchaseHistoryService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})