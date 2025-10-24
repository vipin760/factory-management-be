const express = require('express')
const routes = express()
const unitMasterController = require('../controllers/unit.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',unitMasterController.createUnitMaster)
routes.get('/',unitMasterController.getAllUnitMaster);
routes.delete('/:id',unitMasterController.deleteUnitMaster);
routes.put('/:id',unitMasterController.updateUnitMaster);
module.exports = routes