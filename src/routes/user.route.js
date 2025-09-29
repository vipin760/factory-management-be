const express = require('express')
const routes = express()
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',userController.createuser)
routes.get('/',userController.getAlluser);
routes.get('/:id',userController.getAlluserById);
routes.put('/:id',userController.updateuser);
routes.delete('/:id',userController.deleteuser);
module.exports = routes