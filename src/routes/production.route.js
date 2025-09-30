const express = require('express')
const routes = express()
const productionController = require('../controllers/production.controller');
const { authenticate } = require('../middleware/auth');
routes.use(authenticate)
routes.post('/',productionController.createproduction)

module.exports = routes