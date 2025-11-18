const express = require('express')
const routes = express()
const indentController = require('../controllers/indent.controller');
const { authenticate, authorizeRoles } = require('../middleware/auth');

// storekeeper, jailor, superintendent

routes.use(authenticate)
routes.post("/",authorizeRoles("superintendent","storekeeper"),indentController.createIndent);
routes.get("/",authorizeRoles("superintendent","storekeeper"),indentController.getAllIndent);
routes.delete("/:id",authorizeRoles("superintendent"),indentController.deleteIndent);
routes.put("/:id",authorizeRoles("superintendent"),indentController.updateIndent);
routes.get("/:id",authorizeRoles("superintendent","storekeeper"),indentController.getByIndentId);

module.exports = routes