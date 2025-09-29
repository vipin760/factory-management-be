const express = require('express')
const routes = express()
const vendorsController = require('../controllers/vendors.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');

routes.use(authenticate)
routes.post("/",vendorsController.createvendor)
routes.get("/",vendorsController.fetchVendor)
routes.put("/:id",authorizeRoles("admin"),vendorsController.updateVendor)
routes.delete("/:id",vendorsController.deleteVendor)

module.exports = routes