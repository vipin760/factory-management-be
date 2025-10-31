const express = require('express')
const routes = express()
const manufactureArticlesController = require('../controllers/transitRegister.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',manufactureArticlesController.createtransitRegister)
routes.get('/',manufactureArticlesController.fetchtransitRegister)
routes.put('/:id',manufactureArticlesController.updatetransitRegister)
routes.delete('/:id',manufactureArticlesController.deletetransitRegister)
routes.get('/:id',manufactureArticlesController.fetchtransitRegisterById)

module.exports = routes