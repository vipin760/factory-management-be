const express = require('express')
const routes = express()
const batchController = require('../controllers/batch.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',batchController.createbatch)
routes.get('/',batchController.getAllbatch)
routes.put('/:id',batchController.updatebatch)
routes.delete('/:id',batchController.deletebatch)

module.exports = routes