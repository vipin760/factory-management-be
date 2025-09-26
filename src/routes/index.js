const express = require('express')
const routes = express()
const indexController = require('../controllers/index.controller');
routes.get('/',indexController.index)

module.exports = routes