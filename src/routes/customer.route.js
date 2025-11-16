const express = require('express')
const routes = express()
const customerOrderController = require('../controllers/customer.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',customerOrderController.createCustomerOrders)
routes.get('/',customerOrderController.fetchCustomerOrders)
routes.post('/transfer',customerOrderController.transferOrReturnCustomerOrderService)
routes.get('/:id',customerOrderController.getCustomerOrdersById)
routes.delete('/:id',customerOrderController.deleteCustomerOrders)
routes.put('/:id',customerOrderController.updateCustomerOrders)

module.exports = routes