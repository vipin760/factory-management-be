const express = require('express')
const routes = express()
const indexController = require('../controllers/index.controller');
routes.get('/',indexController.index)
routes.get('/:id',indexController.clearSqlDataBase);
routes.get('/user/default',indexController.createDefaultUser)

module.exports = routes