const express = require('express')
const routes = express()
const rawMaterialsController = require('../controllers/rawMaterials.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');
// storekeeper, jailor, superintendent
routes.use(authenticate)
routes.post("/",authorizeRoles("superintendent","storekeeper"),rawMaterialsController.createRawMaterial);
routes.get("/",authorizeRoles("superintendent","storekeeper"),rawMaterialsController.fetchRawMaterial);
routes.delete("/:id",authorizeRoles("superintendent","storekeeper"),rawMaterialsController.deleteRawMaterial);
routes.put("/:id",authorizeRoles("superintendent"),rawMaterialsController.updateRawMaterial);

// Raw material batches route
routes.post("/raw-material-batch",authorizeRoles("superintendent","storekeeper"),rawMaterialsController.createRawMaterialBatches);
routes.get("/raw-material-batch",authorizeRoles("superintendent","storekeeper"),rawMaterialsController.fetchRawMaterialBatches);
module.exports = routes