const express = require('express')
const routes = express()
const productionController = require('../controllers/production.controller');
const { authenticate } = require('../middleware/auth');
routes.use(authenticate)
routes.post('/',productionController.createproduction)
routes.get('/',productionController.fetchproduction)
routes.put('/:id',productionController.updateproduction)
routes.get('/batch',productionController.fetchBatchesName)


module.exports = routes