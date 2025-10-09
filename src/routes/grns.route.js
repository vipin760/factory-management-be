const express = require('express')
const routes = express()
const grnsController = require('../controllers/grns.controller');
const { authenticate } = require('../middleware/auth');

routes.use(authenticate)
routes.post('/',grnsController.creategrn)
routes.get('/',grnsController.getAllgrn)
routes.get('/:id',grnsController.getSinlgegrn)
routes.put('/:id',grnsController.updategrn)
routes.delete('/:id',grnsController.deletegrn)

module.exports = routes