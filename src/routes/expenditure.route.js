const express = require('express')
const routes = express()
const expenditureController = require('../controllers/expenditure.controller');
routes.get('/',expenditureController.fetchExpenditure)

module.exports = routes