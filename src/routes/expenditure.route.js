const express = require('express')
const routes = express()
const expenditureController = require('../controllers/expenditure.controller');
routes.get('/',expenditureController.fetchExpenditure)
routes.get('/report',expenditureController.reportAndAnalytics)
routes.get('/production-report',expenditureController.productionReportAndAnalytics)
routes.get('/financial-report',expenditureController.generateFinancialReport)
routes.get('/inventory-report',expenditureController.generateInventoryReport)
routes.get('/vendor-report',expenditureController.generateVendorReport)
routes.get('/quality-control-report',expenditureController.generateQualityControleReport)
routes.get('/quality-operationEfficiency-report',expenditureController.generateOperationalEfficiencyReport)

module.exports = routes