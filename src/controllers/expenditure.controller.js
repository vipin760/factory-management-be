const expenditureServices = require("../services/expenditure.services")
const catchAsync = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/errorHandler");

exports.fetchExpenditure = catchAsync( async(req ,res ,next)=>{
    const { status,
      summary,
      data,
      page,
      limit,
      totalItems,
      totalPages,
      monthlyCosts} =await expenditureServices.getMonthlyExpensesReportService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,
      summary,
      data,
      page,
      limit,
      totalItems,
      totalPages,
      monthlyCosts})
})

exports.reportAndAnalytics = catchAsync( async(req ,res ,next)=>{
    const {status, data, message} =await expenditureServices.reportAndAnalytics(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    return res.status(200).send({status,data,message})
})

exports.productionReportAndAnalytics = catchAsync(async (req, res, next) => {
    // Use query for GET requests, body for POST
    const params = { ...req.query, ...req.body };

    const result = await expenditureServices.getMonthlyProductionReportService(params);

    if (!result.status) return next(new ErrorHandler(result.message || 'Something went wrong', 400));

    if (result.format === 'csv') {
        const { Parser } = require('json2csv');
        const fields = result.headers.map(h => ({ label: h, value: h }));
        const parser = new Parser({ fields });
        const csv = parser.parse(result.csvData);

        res.setHeader('Content-Disposition', 'attachment; filename=monthly_production_report.csv');
        res.setHeader('Content-Type', 'text/csv');
        return res.status(200).end(csv);
    }

    res.status(200).send({
        status: true,
        message: "Production summary report fetched successfully",
        data: {
            headers: result.headers,
            rows: result.rows
        }
    });
});


exports.generateFinancialReport = catchAsync(async (req, res, next) => {
    const result = await expenditureServices.generateFinancialReportService(req.query);

    if (!result.status) return next(new ErrorHandler(result.message, 400));

    if (result.format === 'csv') {
        res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
        res.setHeader('Content-Type', 'text/csv');
        return res.status(200).end(result.csv);
    }

    return res.status(200).send({
        status: true,
        message: "Financial report generated successfully",
        headers: result.headers,
        data: result.data
    });
});

exports.generateInventoryReport = catchAsync(async (req, res, next) => {
    const { status, data, message,headers, format, csv, filename } = await expenditureServices.generateInventoryReportService(req.query);
    if (!status) return next(new ErrorHandler(message, 400));

    if (format === 'csv') {
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.setHeader('Content-Type', 'text/csv');
        return res.send(csv);
    }

    return res.status(200).send({
        status: true,
        message: "Inventory report generated successfully",
        headers: headers,
        data: data
    });
});

exports.generateVendorReport = catchAsync(async (req, res, next) => {
    const { status, data, message,headers, format, csv, filename } = await expenditureServices.generateVendorPerformanceReport(req.query);
    if (!status) return next(new ErrorHandler(message, 400));

    if (format === 'csv') {
        res.header('Content-Type', 'text/csv');
        res.attachment(filename);
        return res.send(csv);
    }

    return res.status(200).send({
        status: true,
        message: "Inventory report generated successfully",
        headers: headers,
        data: data
    });
});

exports.generateQualityControleReport = catchAsync( async(req ,res ,next)=>{
    const {status, data, message,headers, format, csv, filename} =await expenditureServices.generateQualityControlReport(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    if (format === 'csv') {
        res.header('Content-Type', 'text/csv');
        res.attachment(filename);
        return res.send(csv);
    }
    return res.status(200).send({
        status: true,
        message: "Quality report generated successfully",
        headers: headers,
        data: data
    });
})

exports.generateOperationalEfficiencyReport = catchAsync( async(req ,res ,next)=>{
    const {status, data, message,headers, format, csv, filename} =await expenditureServices.generateOperationalEfficiencyReportService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    if (format === 'csv') {
        res.header('Content-Type', 'text/csv');
        res.attachment(filename);
        return res.send(csv);
    }
    return res.status(200).send({
        status: true,
        message: "Quality report generated successfully",
        headers: headers,
        data: data
    });
})

exports.generateAllreports = catchAsync( async(req ,res ,next)=>{
    const {status, data, message,headers, format, csv, filename} =await expenditureServices.generateOperationalEfficiencyReportService(req.query)
    if(!status) return next(new ErrorHandler(message,400));
    if (format === 'csv') {
        res.header('Content-Type', 'text/csv');
        res.attachment(filename);
        return res.send(csv);
    }
    return res.status(200).send({
        status: true,
        message: "Quality report generated successfully",
        headers: headers,
        data: data
    });
})
