const express = require('express')
const routes = express()
const unitMasterController = require('../controllers/unit.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',unitMasterController.createUnitMaster)
routes.get('/',unitMasterController.getAllUnitMaster);
routes.delete('/:id',unitMasterController.deleteUnitMaster);
routes.put('/:id',unitMasterController.updateUnitMaster);
routes.get("/raw-materials",authorizeRoles("admin","productionsupervisor"),unitMasterController.getAllRawMaterialsWithindentwiseController);
module.exports = routes