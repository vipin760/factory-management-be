const express = require('express')
const routes = express()
const purchaseController = require('../controllers/purchase.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',authorizeRoles("admin"),purchaseController.createPurchase)
routes.get('/',authorizeRoles("admin"),purchaseController.fetchPurchase)
routes.delete('/:id',authorizeRoles("admin"),purchaseController.deletePurchase)
routes.put('/:id',authorizeRoles("admin"),purchaseController.updatePurchase)

module.exports = routes