const express = require('express')
const routes = express()
const indentController = require('../controllers/indent.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');

routes.use(authenticate)
routes.post("/",authorizeRoles("admin","productionsupervisor"),indentController.createIndent);
routes.get("/",authorizeRoles("admin","productionsupervisor"),indentController.getAllIndent);
routes.delete("/:id",authorizeRoles("admin"),indentController.deleteIndent);
routes.put("/:id",authorizeRoles("admin"),indentController.updateIndent);
routes.get("/:id",authorizeRoles("admin","productionsupervisor"),indentController.getByIndentId);
routes.get("/:indent_id/raw-materials",authorizeRoles("admin","productionsupervisor"),indentController.getAllRawMaterialsWithindentwiseController);

module.exports = routes