const express = require('express')
const routes = express()
const productController = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',productController.createproduct)
routes.get('/',productController.fetchproduct)
routes.put('/:id',productController.updateproduct)
routes.delete('/:id',productController.deleteproduct)

module.exports = routes