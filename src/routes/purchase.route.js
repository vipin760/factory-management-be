const express = require('express')
const routes = express()
const purchaseController = require('../controllers/purchase.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');
// storekeeper, jailor, superintendent
routes.use(authenticate)
routes.post('/',authorizeRoles("superintendent","storekeeper"),purchaseController.createPurchase)
routes.get('/',authorizeRoles("superintendent","storekeeper"),purchaseController.fetchPurchase)
routes.delete('/:id',authorizeRoles("superintendent"),purchaseController.deletePurchase)
routes.put('/:id',authorizeRoles("superintendent"),purchaseController.updatePurchase)

module.exports = routes