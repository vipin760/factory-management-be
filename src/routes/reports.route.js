const express = require('express')
const routes = express()
const reportController = require('../controllers/reports.controller');
routes.get('/',reportController.createReports)
routes.get('/expenditure',reportController.getMonthlyExpensesReport)

module.exports = routes