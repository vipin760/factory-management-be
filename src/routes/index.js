const express = require('express')
const routes = express()
const indexController = require('../controllers/index.controller');
routes.get('/',indexController.index)
routes.get('/:id',indexController.clearSqlDataBase);

module.exports = routes