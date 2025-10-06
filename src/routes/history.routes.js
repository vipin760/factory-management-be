const express = require('express')
const routes = express()
const historyController = require('../controllers/history.controller');
const { authenticate } = require('../middleware/auth');
routes.use(authenticate)
routes.get('/',historyController.getAllHistory)

module.exports = routes