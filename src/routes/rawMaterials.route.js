const express = require('express')
const routes = express()
const rawMaterialsController = require('../controllers/rawMaterials.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');

routes.use(authenticate)
routes.post("/",authorizeRoles("admin","productionsupervisor"),rawMaterialsController.createRawMaterial);
routes.get("/",authorizeRoles("admin","productionsupervisor"),rawMaterialsController.fetchRawMaterial);
routes.delete("/:id",authorizeRoles("admin","productionsupervisor"),rawMaterialsController.deleteRawMaterial);
routes.put("/:id",authorizeRoles("admin"),rawMaterialsController.updateRawMaterial);

module.exports = routes